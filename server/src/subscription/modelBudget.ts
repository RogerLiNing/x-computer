import {AsyncLocalStorage} from 'node:async_hooks';
import type {SubscriptionService} from './SubscriptionService.js';
import type {ModelCallLease} from './ModelCallQueue.js';
import {fetchWithConnectRetry} from '../llm/connectRetry.js';

export class ModelQuotaError extends Error {
  constructor(message='本期模型调用次数已用完。进度会保留，可在额度恢复后继续。') {super(message);this.name='ModelQuotaError';}
}
export class ModelBudgetUnavailableError extends Error {
  constructor(message='暂时无法确认模型额度，已暂停模型调用，请稍后继续。'){super(message);this.name='ModelBudgetUnavailableError';}
}
export const isModelBudgetError=(error:unknown):boolean=>error instanceof ModelQuotaError||error instanceof ModelBudgetUnavailableError;
interface BudgetContext {service:Pick<SubscriptionService,'consumeAiCall'> & Partial<Pick<SubscriptionService,'acquireModelSlot'|'waitingForModel'>>;userId?:string;runId?:string;signal?:AbortSignal;assertRun?:()=>Promise<void>;}
const context=new AsyncLocalStorage<BudgetContext>();
export function currentModelBudgetSignal(){return context.getStore()?.signal;}
export function currentModelBudgetService(){return context.getStore()?.service;}
export function withModelBudget<T>(scope:BudgetContext,work:()=>T):T{
  const parent=context.getStore();
  const runId=scope.runId??(parent?.userId===scope.userId?parent?.runId:undefined);
  const assertRun=scope.assertRun??(parent?.userId===scope.userId&&parent?.runId===runId?parent?.assertRun:undefined);
  return context.run({...scope,runId,assertRun},work);
}

/** Reserve each outbound provider attempt, including transport fallbacks. Never store credentials or prompts. */
export async function modelFetch(url:string,init:RequestInit):Promise<Response>{
  init.signal?.throwIfAborted();
  const scope=context.getStore();
  const inputSignal=scope?.signal&&init.signal?AbortSignal.any([scope.signal,init.signal]):scope?.signal??init.signal??undefined;
  inputSignal?.throwIfAborted();
  let lease:ModelCallLease|undefined;
  try{
  if(scope){
    if(!scope.userId||scope.userId==='anonymous')throw new ModelQuotaError('请先登录，才能使用共享模型额度。');
    await scope.assertRun?.();
    let model:unknown;try{model=JSON.parse(typeof init.body==='string'?init.body:'{}').model;}catch{/* Optional metadata does not determine authorization. */}
    lease=await scope.service.acquireModelSlot?.(scope.userId,scope.runId,inputSignal);
    await lease?.assert();
    await scope.assertRun?.();
    await scope.service.consumeAiCall(scope.userId,{runId:scope.runId,model:typeof model==='string'?model.slice(0,256):undefined},lease?.signal??inputSignal,lease?.ticket);
  }
  init.signal?.throwIfAborted();
  await lease?.assert();
  await scope?.assertRun?.();
  const signal=lease?.signal??inputSignal;signal?.throwIfAborted();
  const response=await fetchWithConnectRetry(url,{...init,signal});
  if(!lease)return response;
  if(!response.body){await lease.release();return response;}
  return leasedResponse(response,lease);
  }catch(error){await lease?.release();throw error;}
}

/** Hold a slot through the body, including streaming, and release on every terminal path. */
function leasedResponse(response:Response,lease:ModelCallLease):Response{
  const reader=response.body!.getReader();let ended=false,control:ReadableStreamDefaultController<Uint8Array>;
  const finish=async()=>{if(ended)return;ended=true;lease.signal.removeEventListener('abort',abort);await lease.release();};
  const abort=()=>{if(ended)return;control.error(lease.signal.reason);void reader.cancel(lease.signal.reason).catch(()=>{}).finally(finish);};
  const body=new ReadableStream<Uint8Array>({
    start(controller){control=controller;lease.signal.addEventListener('abort',abort,{once:true});if(lease.signal.aborted)abort();},
    async pull(controller){
      try{const chunk=await reader.read();if(ended)return;if(chunk.done){await finish();controller.close();}else controller.enqueue(chunk.value);}
      catch(error){if(ended)return;await finish();controller.error(error);}
    },
    async cancel(reason){try{await reader.cancel(reason);}finally{await finish();}},
  });
  const wrapped=new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  Object.defineProperties(wrapped,{url:{value:response.url},redirected:{value:response.redirected},type:{value:response.type}});
  return wrapped;
}
