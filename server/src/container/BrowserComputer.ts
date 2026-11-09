import type {BrowserUploadStore} from './BrowserUploadStore.js';
import type { BrowserDownloadStore } from './BrowserDownloadStore.js';
import { setTimeout as delay } from 'node:timers/promises';
import Docker from 'dockerode';
import { createDockerClient } from '../docker/dockerSocket.js';
import { PassThrough } from 'node:stream';
import type { UserContainerManager } from './UserContainerManager.js';

export function assertBrowserAction(input:Record<string,unknown>){
  if(!['navigate','click','type','key','scroll','new_tab','switch_tab','close_tab'].includes(String(input.action)))throw new Error('模型浏览器工具不支持此操作');
}

/** Docker exec is the transport; no browser port is published on the host. */
export class BrowserComputer {
  private provisioning = new Map<string,Promise<string>>();
  private docker = createDockerClient();
  constructor(private containers: Pick<UserContainerManager,'getOrCreateContainer'|'findRunningContainer'>, private downloads?: BrowserDownloadStore, private uploads?: BrowserUploadStore) {}
  async waitForControl(userId:string, signal?:AbortSignal):Promise<void> {
    for (;;) {
      signal?.throwIfAborted();
      const state=await this.request(userId,'agent',{action:'state'});
      if(!state.started)throw new Error('请先由用户打开助手电脑');
      if(state.holder==='agent')return;
      await delay(1000,undefined,{signal});
    }
  }
  async request(userId:string, actor:'human'|'agent', input:Record<string,unknown>):Promise<Record<string,any>> {
    if(!/^[\w-]{1,128}$/.test(userId) || userId==='anonymous') throw new Error('请先登录');
    if(Buffer.byteLength(JSON.stringify(input))>16000)throw new Error('浏览器操作参数过大');
    if(['upload_request','upload_approve'].includes(String(input.action)))throw new Error('上传必须通过用户确认流程');
    if(input.action==='downloads'||input.action==='present_download'){
      if(!this.downloads)throw new Error('浏览器成果交付未启用');
      if(input.action==='downloads')return {downloads:await this.downloads.list(userId)};
      if(typeof input.id!=='string')throw new Error('下载标识无效');
      return this.downloads.present(userId,input.id);
    }
    return this.send(userId,actor,input);
  }
  async requestUpload(userId:string,input:{path:string;target:number;snapshot:string}){
    if(!this.uploads)throw new Error('文件上传未启用');
    const file=await this.uploads.inspect(userId,input.path);
    return this.send(userId,'agent',{action:'upload_request',file,target:input.target,snapshot:input.snapshot});
  }
  async approveUpload(userId:string,id:string){
    if(!this.uploads)throw new Error('文件上传未启用');
    const state=await this.request(userId,'human',{action:'state'});
    const request=state.uploadRequests?.find((item:Record<string,unknown>)=>item.id===id);
    if(!request||request.status!=='pending')throw new Error('上传请求已处理或不存在');
    try{await this.uploads.stage(userId,id,request.file);}
    catch(error){await this.request(userId,'human',{action:'upload_cancel',id}).catch(()=>{});throw error;}
    try{return await this.send(userId,'human',{action:'upload_approve',id});}
    finally{await this.uploads.removeStage(userId,id);}
  }
  private async send(userId:string,actor:'human'|'agent',input:Record<string,unknown>):Promise<Record<string,any>>{
    if(!/^[\w-]{1,128}$/.test(userId)||userId==='anonymous')throw new Error('请先登录');
    if(Buffer.byteLength(JSON.stringify(input))>16000)throw new Error('浏览器操作参数过大');
    if(input.action==='state' && !await this.containers.findRunningContainer(userId)) return {started:false,holder:'human'};
    let pending=this.provisioning.get(userId);
    if(!pending){pending=this.containers.getOrCreateContainer({userId});this.provisioning.set(userId,pending);}
    let id:string;try{id=await pending;}finally{if(this.provisioning.get(userId)===pending)this.provisioning.delete(userId);}
    const encoded=Buffer.from(JSON.stringify({...input,actor})).toString('base64url');
    const exec=await this.docker.getContainer(id).exec({Cmd:['node','/opt/x-browser/browser-client.mjs',encoded],AttachStdout:true,AttachStderr:true});
    const stream=await exec.start({Detach:false});
    const stdout=new PassThrough();const stderr=new PassThrough();
    let output='';let size=0;
    this.docker.modem.demuxStream(stream,stdout,stderr);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{stream.destroy();reject(new Error('浏览器响应超时，请先查看当前画面，勿重复提交操作'));},25000);
      stdout.on('data',chunk=>{size+=chunk.length;if(size>4000000){stream.destroy();clearTimeout(timer);reject(new Error('浏览器画面过大'));}else output+=chunk;});
      stderr.resume();
      stream.on('error',error=>{clearTimeout(timer);reject(error);});
      stream.on('end',()=>{clearTimeout(timer);try{const result=JSON.parse(output);if(!result.ok)throw new Error(result.error || '浏览器操作失败');resolve(result.value);}catch(error){reject(error);}});
    });
  }
}
