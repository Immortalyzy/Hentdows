// Runs once per application renderer, including while the reader is closed.
// Model weights live in the compiled programs; page textures are temporary.
let gl, canvas, programs, blit, framebuffer, renderer, timerExtension;
const vertex = `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;
function program(fragment) {
  const shaders = [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]].map(([type, source]) => {
    const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  });
  const p = gl.createProgram(); shaders.forEach(s => gl.attachShader(p, s)); gl.linkProgram(p);
  shaders.forEach(s => gl.deleteShader(s));
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
function adapt(source) {
  // Keep upstream arithmetic/weights intact. Supply mpv's texture helpers in GLSL ES.
  const names = ['MAIN', 'conv2d_tf', 'conv2d_1_tf', 'conv2d_2_tf', 'conv2d_last_tf'];
  return source.split(/\/\/!DESC[^\n]*\n/).slice(1).map(part => {
    let header = '#version 300 es\nprecision highp float;\nprecision highp int;\nuniform vec2 outputSize;\nout vec4 color;\n';
    for (const name of names) if (part.includes(name)) header += `uniform sampler2D ${name};
#define ${name}_size vec2(textureSize(${name},0))
#define ${name}_pt (1. / ${name}_size)
#define ${name}_pos (gl_FragCoord.xy / outputSize)
#define ${name}_tex(p) texture(${name},p)
#define ${name}_texOff(p) texture(${name},${name}_pos + (p)*${name}_pt)
`;
    return program(header + part + '\nvoid main(){color=hook();}');
  });
}
function texture(width, height, floating = false, image) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, floating ? gl.NEAREST : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, floating ? gl.NEAREST : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  else gl.texImage2D(gl.TEXTURE_2D, 0, floating ? gl.RGBA16F : gl.RGBA8, width, height, 0, gl.RGBA, floating ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
  return t;
}
function draw(p, target, width, height, inputs, region) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? framebuffer : null);
  if (target) {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('GPU texture unavailable');
  }
  gl.viewport(0, 0, width, height); gl.useProgram(p);
  gl.uniform2f(gl.getUniformLocation(p, 'outputSize'), width, height);
  if(region){gl.uniform2f(gl.getUniformLocation(p,'fullSize'),region.width,region.height);gl.uniform2f(gl.getUniformLocation(p,'tileOrigin'),0,region.bottom);}
  Object.entries(inputs).forEach(([name, t], i) => {
    gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(gl.getUniformLocation(p, name), i);
  });
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
const ready = (async () => {
  canvas = new OffscreenCanvas(1, 1);
  gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, powerPreference: 'high-performance'});
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('GPU upscaling is unavailable');
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  timerExtension=gl.getExtension('EXT_disjoint_timer_query_webgl2');
  renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  // Never spend seconds per page on a software rasterizer.
  if (/swiftshader|llvmpipe|software|basic render/i.test(renderer)) throw new Error('Hardware GPU acceleration is unavailable');
  canvas.addEventListener('webglcontextlost', () => postMessage({type: 'unavailable', error: 'GPU context lost; originals remain available'}));
  const response = await fetch('vendor/Anime4K_Upscale_CNN_x2_S.glsl');
  if (!response.ok) throw new Error('Anime4K model is unavailable');
  programs = adapt(await response.text());
  if (programs.length !== 5) throw new Error('Unexpected Anime4K model');
  blit = program(`#version 300 es
precision highp float;uniform sampler2D source;uniform vec2 fullSize;uniform vec2 tileOrigin;out vec4 color;
void main(){vec2 uv=(gl_FragCoord.xy+tileOrigin)/fullSize;color=texture(source,vec2(uv.x,1.-uv.y));color.a=1.;}`);
  framebuffer = gl.createFramebuffer();
  postMessage({type: 'ready', renderer, programs: programs.length});
})();
ready.catch(error => postMessage({type: 'unavailable', error: error.message}));
onmessage = async ({data: {id, image, scale}}) => {
  const allocated = []; const start = performance.now();let query,queryActive=false,bitmap;
  try {
    await ready;
    const w = image.width, h = image.height, max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (![2, 4].includes(scale) || Math.max(w, h) >= 2048 || w * h * scale * scale > 40e6 || w * scale > max || h * scale > max) throw new Error('Page exceeds the upscaling size limit');
    const make = (...args) => {const t = texture(...args); allocated.push(t); return t;};
    let input = make(w, h, false, image), width = w, height = h;
    if(timerExtension){query=gl.createQuery();gl.beginQuery(timerExtension.TIME_ELAPSED_EXT,query);queryActive=true;}
    for (let step = 1; step < scale; step *= 2) {
      let previous = input;
      const names = ['MAIN', 'conv2d_tf', 'conv2d_1_tf', 'conv2d_2_tf', 'conv2d_last_tf'];
      for (let i = 0; i < programs.length; i++) {
        const last = i === programs.length - 1;
        const output = make(width * (last ? 2 : 1), height * (last ? 2 : 1), !last);
        draw(programs[i], output, width * (last ? 2 : 1), height * (last ? 2 : 1), {MAIN: input, [names[i]]: previous});
        previous = output;
      }
      input = previous; width *= 2; height *= 2;
    }
    canvas.width = width; canvas.height = height;
    if(gl.drawingBufferWidth===width&&gl.drawingBufferHeight===height){
      draw(blit,null,width,height,{source:input},{width,height,bottom:0});
      bitmap=canvas.transferToImageBitmap();
    }else{
      // Chromium can clamp large WebGL drawing buffers below MAX_TEXTURE_SIZE.
      // Compose strips on the GPU rather than silently returning a smaller 4× page.
      const output=new OffscreenCanvas(width,height),ctx=output.getContext('2d',{alpha:false});
      for(let top=0;top<height;top+=2048){
        const strip=Math.min(2048,height-top);canvas.width=width;canvas.height=strip;
        if(gl.drawingBufferWidth!==width||gl.drawingBufferHeight!==strip)throw new Error('GPU output size unavailable');
        draw(blit,null,width,strip,{source:input},{width,height,bottom:height-top-strip});
        ctx.drawImage(canvas,0,top);
      }
      bitmap=output.transferToImageBitmap();output.width=output.height=1;
    }
    if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) throw new Error('GPU scaling failed');
    if(query){gl.endQuery(timerExtension.TIME_ELAPSED_EXT);queryActive=false;}
    // Await completion without blocking either the UI or this worker's event loop.
    const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();
    try{
      for(;;){const state=gl.clientWaitSync(fence,0,0);if(state===gl.ALREADY_SIGNALED||state===gl.CONDITION_SATISFIED)break;if(state===gl.WAIT_FAILED||performance.now()-start>10000)throw new Error('GPU completion failed');await new Promise(resolve=>setTimeout(resolve,1));}
    }finally{gl.deleteSync(fence);}
    const gpuMs=query&&gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)&&!gl.getParameter(timerExtension.GPU_DISJOINT_EXT)?gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6:undefined;
    postMessage({type: 'result', id, bitmap, ms: performance.now() - start, gpuMs}, [bitmap]);bitmap=null;
  } catch (error) {postMessage({type: 'result', id, error: error.message});}
  finally {
    bitmap?.close(); image?.close();
    if(queryActive)gl.endQuery(timerExtension.TIME_ELAPSED_EXT);
    if(query)gl.deleteQuery(query);
    if(framebuffer){
      gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,null,0);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    }
    allocated.forEach(t => gl?.deleteTexture(t)); canvas.width = 1; canvas.height = 1;
  }
};
