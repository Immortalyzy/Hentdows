const {Worker}=require('node:worker_threads');
const {EventEmitter}=require('node:events');
const path=require('node:path');
class Library extends EventEmitter {
  constructor(file) {
    super();this.next=0;this.pending=new Map();this.closed=false;
    this.worker=new Worker(path.join(__dirname,'library-worker.cjs'),{workerData:{file}});
    this.worker.on('message',message=>{
      if(message.event) {this.emit(message.event,message.state);return;}
      const pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);
      if(message.error)pending.reject(new Error(message.error));else pending.resolve(message.value);
    });
    this.worker.on('error',error=>{this.failure=error;for(const p of this.pending.values())p.reject(error);this.pending.clear();this.emit('problem',error.message);});
    this.worker.on('exit',()=>{this.closed=true;for(const p of this.pending.values())p.reject(new Error('Library worker stopped.'));this.pending.clear();});
  }
  call(method,input) {
    if(this.closed||this.failure)return Promise.reject(this.failure||new Error('Library is closed.'));
    return new Promise((resolve,reject)=>{const id=++this.next;this.pending.set(id,{resolve,reject});this.worker.postMessage({id,method,input});});
  }
  async close() {await this.call('cancel').catch(()=>{});await this.call('close').catch(()=>{});await this.worker.terminate();}
}
module.exports={Library};
