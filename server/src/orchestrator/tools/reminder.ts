import {backgroundAutostartEnabled} from '../../config/backgroundRuntime.js';
import type { ToolDefinition } from '@x-computer/shared';
import type { AppDatabase } from '../../db/database.js';
import { getDefaultScheduler } from '../../scheduler/XScheduler.js';
import type { ToolHandler } from './types.js';

export const reminderDefinition:ToolDefinition={
  name:'x.schedule_reminder',displayName:'到时间提醒我',domain:['chat','agent'],riskLevel:'low',requiredPermissions:[],
  description:'设置纯提醒，到点写入当前原对话和持久通知。到点不调用模型，不执行提醒文字里的操作。时间只能选 at、cron、in_minutes、in_hours 之一；at 使用带时区的 ISO 或时间戳。需要到点自动办事时改用 x.schedule_run。会话由服务端绑定，不能指定别人的会话。',
  parameters:[{name:'message',type:'string',description:'要提醒的内容，最多2000字',required:true},{name:'at',type:'string',description:'一次性提醒时间，带时区ISO或时间戳',required:false},{name:'cron',type:'string',description:'周期提醒五段cron，目前按服务器时区',required:false},{name:'in_minutes',type:'number',description:'多少分钟后提醒，正数',required:false},{name:'in_hours',type:'number',description:'多少小时后提醒，正数',required:false}],
};

export function createReminderHandler(db?:AppDatabase):ToolHandler{
  return async(input,context)=>{
    const scope=context as {userId?:string;runId?:string}|undefined;
    if(!db||!scope?.userId||scope.userId==='anonymous'||!scope.runId)throw new Error('请在已登录的交办对话里添加提醒');
    const message=typeof input.message==='string'?input.message.trim():'';
    if(!message||message.length>2000)throw new Error('提醒内容须为1至2000字');
    const times=['at','cron','in_minutes','in_hours'].filter(key=>input[key]!==undefined&&input[key]!==null&&input[key]!=='');
    if(times.length!==1)throw new Error('请只指定一种提醒时间');
    for(const key of ['in_minutes','in_hours'])if(input[key]!=null&&(typeof input[key]!=='number'||!Number.isFinite(input[key])||input[key]<=0))throw new Error('相对提醒时间须为正数');
    if(input.at!=null&&typeof input.at!=='number'&&typeof input.at!=='string'||input.cron!=null&&typeof input.cron!=='string')throw new Error('提醒时间格式无效');
    const task=await db.queryOne<{user_id:string;metadata_json:string}>('SELECT user_id,metadata_json FROM tasks WHERE id=? AND user_id=?',[scope.runId,scope.userId]);
    if(!task||task.user_id!==scope.userId)throw new Error('原交办不存在或无权访问');
    const run=JSON.parse(task.metadata_json??'{}').chatRun;
    if(run?.id!==scope.runId||run.userId!==scope.userId||(await db.getSession(run.sessionId))?.user_id!==scope.userId)throw new Error('原对话不存在或无权访问');
    const scheduler=getDefaultScheduler();if(!scheduler)throw new Error('提醒服务未就绪，尚未添加');
    const job=await scheduler.addJob(scope.userId,message,input.at as string|number|undefined,input.cron as string|undefined,input.in_minutes as number|undefined,input.in_hours as number|undefined,run.sessionId,`提醒: ${message.slice(0,40)}`);
    return {ok:true,jobId:job.id,runAt:job.runAt,runAtISO:new Date(job.runAt).toISOString(),sessionId:job.sessionId,mode:'reminder',backgroundPaused:!backgroundAutostartEnabled(),message:backgroundAutostartEnabled()?'提醒已保存；到点只提醒，不自动执行内容中的操作':'提醒已保存，但后台自动启动已暂停，恢复后台运行后才会处理'};
  };
}
