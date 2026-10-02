// Independent CPU evaluation of the checked-in network for a tiny GPU parity fixture.
// No image files or user profile are involved.
module.exports=function reference(source,width,height,rgba){
  let input=Float64Array.from(rgba,x=>x/255),data=input;
  const parts=source.split(/\/\/!DESC[^\n]*\n/).slice(1,5);
  for(const [layer,part] of parts.entries()){
    const kernels=[...part.matchAll(/mat4\(([^)]+)\) \* go_(\d)\(([-\d.]+), ([-\d.]+)\)/g)].map(m=>({weights:m[1].split(',').map(Number),negative:m[2]==='1',dx:Number(m[3]),dy:Number(m[4])}));
    const bias=/result \+= vec4\(([^)]+)\)/.exec(part)[1].split(',').map(Number),out=new Float64Array(data.length);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++){
      let sum=bias[c];
      for(const k of kernels)for(let channel=0;channel<4;channel++){
        let v=data[(Math.max(0,Math.min(height-1,y+k.dy))*width+Math.max(0,Math.min(width-1,x+k.dx)))*4+channel];
        if(layer)v=Math.max(0,k.negative?-v:v);
        sum+=k.weights[channel*4+c]*v;
      }
      out[(y*width+x)*4+c]=sum;
    }
    data=out;
  }
  const out=new Uint8ClampedArray(width*height*16);
  const at=(x,y,c)=>input[(Math.max(0,Math.min(height-1,y))*width+Math.max(0,Math.min(width-1,x)))*4+c];
  for(let y=0;y<height*2;y++)for(let x=0;x<width*2;x++){
    const residual=data[(Math.floor(y/2)*width+Math.floor(x/2))*4+(y%2)*2+x%2];
    const sx=(x+.5)/2-.5,sy=(y+.5)/2-.5,ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
    for(let c=0;c<3;c++)out[(y*width*2+x)*4+c]=255*(residual+(at(ix,iy,c)*(1-fx)+at(ix+1,iy,c)*fx)*(1-fy)+(at(ix,iy+1,c)*(1-fx)+at(ix+1,iy+1,c)*fx)*fy);
    out[(y*width*2+x)*4+3]=255;
  }
  return out;
};
