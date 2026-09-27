// Fixed-height rows bound both DOM nodes and database results for large libraries.
window.VirtualLibrary = class {
  constructor(container,scroll,onRange) {
    this.container=container;this.scroll=scroll;this.onRange=onRange;this.enabled=false;
    const changed=()=>{cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(()=>{
      if(!this.enabled)return;
      const range=this.range();if(range.offset!==this.offset||range.columns!==this.columns)this.onRange();
    });};
    scroll.addEventListener('scroll',changed,{passive:true});this.resize=new ResizeObserver(changed);this.resize.observe(container);
  }
  configure(enabled,view,width,groups=false){this.enabled=enabled;this.view=view;this.width=width;this.groups=groups;}
  range(){
    const width=this.container.clientWidth;
    const columns=this.groups||this.view==='list'?1:this.view==='grid'?Math.max(1,Math.floor((width+10)/(this.width+10))):Number(this.view.slice(-1));
    const rowHeight=this.groups?72:this.view==='list'?182:Math.ceil((width-(columns-1)*10)/columns/0.7+158);
    const top=this.container.getBoundingClientRect().top-this.scroll.getBoundingClientRect().top+this.scroll.scrollTop;
    const row=Math.max(0,Math.floor((this.scroll.scrollTop-top)/rowHeight)-3);
    const offset=Math.floor(row/10)*10*columns;
    const limit=Math.min(200,Math.max(60,Math.ceil(this.scroll.clientHeight/rowHeight+20)*columns));
    return {offset,limit,columns,rowHeight};
  }
  decorate(total,count,range){
    if(!this.enabled){this.container.classList.remove('virtual');return;}
    const r=range||this.range();this.offset=r.offset;this.columns=r.columns;
    this.container.classList.add('virtual');this.container.style.setProperty('--row-height',`${r.rowHeight-10}px`);
    const spacer=height=>{const d=document.createElement('div');d.className='virtual-spacer';d.style.height=`${Math.max(0,height)}px`;return d;};
    this.container.prepend(spacer(Math.floor(r.offset/r.columns)*r.rowHeight));
    this.container.append(spacer((Math.ceil(total/r.columns)-Math.ceil((r.offset+count)/r.columns))*r.rowHeight));
  }
};
