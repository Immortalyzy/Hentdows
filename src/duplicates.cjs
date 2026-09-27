// Adapted from Hentoid's DuplicateHelper, Cosine and ImagePHash algorithms.
function simplify(value){return String(value||'').normalize('NFKC').toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g,'').replace(/[-_?!:;,~/\\|.+#'’"=&]/g,' ').replace(/\s+/g,' ').trim();}
function cosine(a,b){
  if(a===b)return a?1:0;if(a.length<3||b.length<3)return 0;
  const profile=s=>{const m=new Map();for(let i=0;i<s.length-2;i++){const k=s.slice(i,i+3);m.set(k,(m.get(k)||0)+1);}return m;};
  const x=profile(a),y=profile(b);let dot=0,nx=0,ny=0;for(const [k,v]of x){dot+=v*(y.get(k)||0);nx+=v*v;}for(const v of y.values())ny+=v*v;return dot/Math.sqrt(nx*ny);
}
function identity(site,id){return `${['ehentai','exhentai'].includes(site)?'eh':site}:${id}`;}
function titleScore(a,b,sensitivity){
  a=simplify(a);b=simplify(b);const score=cosine(a,b);
  if(score<=[.78,.8,.85][sensitivity])return 0;
  if(score>.995)return score;
  const clean=s=>s.replace(/\d+/g,'').replace(/\b(chapter|chap|part|vol(?:ume)?|issue|update|gaiden|ex)\b/g,'').replace(/\s+/g,' ').trim();
  if(cosine(clean(a),clean(b))>score+.01){
    const bounds=s=>[...s.matchAll(/\d+/g)].filter(m=>m.index+m[0].length>=s.length*.8).slice(-2).map(m=>Number(m[0]));
    const x=bounds(a),y=bounds(b);if(!x.length||!y.length||Math.max(...x)<Math.min(...y)||Math.max(...y)<Math.min(...x))return 0;
  }
  return score;
}
function hashSimilarity(a,b){if(!a||!b)return null;let n=BigInt('0x'+a)^BigInt('0x'+b),different=0;while(n){different++;n&=n-1n;}return 1-different/64;}
function score(reference,candidate,options){
  const s=options.duplicateSensitivity??2,values=[];
  const tags=(b,kind)=>(b.tags||[]).filter(t=>t.startsWith(kind+':')).map(t=>simplify(t.slice(kind.length+1)));
  const languageA=tags(reference,'language'),languageB=tags(candidate,'language');
  if(options.duplicateLanguage&&languageA.length&&languageB.length&&!languageA.some(t=>languageB.includes(t)))return null;
  const artistA=tags(reference,'artist'),artistB=tags(candidate,'artist');
  const artistKey=s=>s.split(' ').sort().join(' ');
  if(options.duplicateArtist&&artistA.length&&artistB.length&&!artistA.some(a=>artistB.some(b=>artistKey(a)===artistKey(b))))return null;
  if(options.duplicateTitle)values.push(titleScore(reference.title,candidate.title,s));
  if(options.duplicateCover){const v=hashSimilarity(reference.coverHash,candidate.coverHash);if(v!==null)values.push(v>=[.8,.85,.9][s]?v:0);}
  if(!values.length)return null;const result=values.reduce((a,b)=>a+b,0)/values.length;return result>=[.8,.85,.9][s]?result:null;
}
const cos=Array.from({length:8},(_,u)=>Array.from({length:48},(_,x)=>Math.cos((2*x+1)/96*u*Math.PI)));
function perceptualHash(bitmap){
  if(bitmap.length!==48*48*4)return null;
  const coeff=[];for(let u=0;u<8;u++)for(let v=0;v<8;v++){
    let sum=0;for(let x=0;x<48;x++)for(let y=0;y<48;y++){const i=(y*48+x)*4,gray=.213*bitmap[i+2]+.715*bitmap[i+1]+.072*bitmap[i];sum+=cos[u][x]*cos[v][y]*gray;}
    coeff.push(sum*(u?1:1/Math.sqrt(2))*(v?1:1/Math.sqrt(2))/4);
  }
  const average=(coeff.reduce((a,b)=>a+b,0)-coeff[0])/63;let hash=0n;
  for(let u=1;u<8;u++)for(let v=1;v<8;v++)hash=(hash<<1n)|(coeff[u*8+v]>average?1n:0n);
  return hash.toString(16).padStart(16,'0');
}
module.exports={simplify,cosine,identity,titleScore,hashSimilarity,score,perceptualHash};
