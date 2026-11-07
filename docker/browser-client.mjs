import { setTimeout as delay } from 'node:timers/promises';
const endpoint='http://127.0.0.1:7788';
const headers={'Content-Type':'application/json'};
// Retry readiness probes only. Never retry an action whose result might have been lost.
let ready=false;
for(let attempt=0;attempt<40;attempt++){
  try{const response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({actor:'human',action:'state'}),signal:AbortSignal.timeout(1000)});if((await response.json()).ok){ready=true;break;}}catch{}
  await delay(250);
}
if(!ready){process.stdout.write(JSON.stringify({ok:false,error:'浏览器启动尚未就绪，请稍后再打开'}));}
else {
  try {
    const response=await fetch(endpoint,{method:'POST',headers,body:Buffer.from(process.argv[2],'base64url').toString(),signal:AbortSignal.timeout(20000)});
    process.stdout.write(await response.text());
  }catch{process.stdout.write(JSON.stringify({ok:false,error:'浏览器通信中断，操作结果未知，请先查看当前画面，不要重复提交'}));}
}
