import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { channelInboxId, channelProcessedKey, captureChannelOrigin } from './channelIdentity.js';
import { handleTelegramMessage } from '../telegram/telegramLoop.js';
import { handleDiscordMessage } from '../discord/discordLoop.js';
import { handleSlackMessage } from '../slack/slackLoop.js';
import { handleQQMessage } from '../qq/qqLoop.js';
import { handleWhatsAppMessage } from '../whatsapp/whatsappLoop.js';
it('keeps historical IDs unchanged and gives each receiving account its own identity namespace',()=>{
  const old=createHash('sha256').update(JSON.stringify(['owner','telegram','peer','id'])).digest('hex').slice(0,32);
  expect(channelInboxId('owner','telegram','peer','id')).toBe(old);
  expect(channelInboxId('owner','telegram','peer','id','A')).not.toBe(channelInboxId('owner','telegram','peer','id','B'));
  expect(channelProcessedKey('processed')).toBe('processed');expect(channelProcessedKey('processed','A')).not.toBe(channelProcessedKey('processed','B'));
  const unknown=captureChannelOrigin(undefined,'connection','{}');expect(unknown.accountId).toBeUndefined();expect(unknown.scopeId).toBe('unverified:connection');
});
it.each([
  ['telegram',handleTelegramMessage,{chatId:'peer',fromId:'contact',fromUsername:'Contact',text:'合成消息',messageId:1,timestamp:1,isGroup:false}],
  ['discord',handleDiscordMessage,{channelId:'peer',fromId:'contact',fromUsername:'Contact',text:'合成消息',messageId:'id',timestamp:1,isDM:true}],
  ['slack',handleSlackMessage,{channelId:'peer',fromId:'contact',fromName:'Contact',text:'合成消息',messageTs:'1.1',timestamp:1,isDM:true}],
  ['qq',handleQQMessage,{messageType:'private',chatId:'peer',fromId:'contact',fromName:'Contact',text:'合成消息',messageId:'id',timestamp:1}],
  ['whatsapp',handleWhatsAppMessage,{fromJid:'peer',text:'合成消息',messageId:'id',timestamp:1,isGroup:false}],
] as const)('%s scopes inbox deduplication and forwards the immutable origin',async(channel,handle,msg)=>{
  const values=new Map<string,string>(), inserted:any[]=[], bridge=vi.fn(async(..._args:any[])=>{});
  const put=async(_user:string,row:any)=>{inserted.push(row);};
  const deps:any={db:{insertChannelMessage:put,insertWhatsAppMessage:put},getConfig:(_u:string,key:string)=>values.get(key),setConfig:(_u:string,key:string,value:string)=>{values.set(key,value);},runIntent:vi.fn(),runAgent:vi.fn(),handleChannelMessageAsChat:bridge};
  const a=captureChannelOrigin('A','connection-a','{}'), b=captureChannelOrigin('B','connection-b','{}');
  await (handle as any)(deps,'owner',{...msg,origin:a});await (handle as any)(deps,'owner',{...msg,origin:a});await (handle as any)(deps,'owner',{...msg,origin:b});
  expect(inserted).toHaveLength(2);expect(inserted[0].id).not.toBe(inserted[1].id);expect(bridge).toHaveBeenCalledTimes(2);
  expect(bridge.mock.calls[0][4]).toMatchObject({origin:a,inboxId:inserted[0].id});expect(bridge.mock.calls[1][4]).toMatchObject({origin:b,inboxId:inserted[1].id});
  if(channel==='qq'){expect(values.get(channelProcessedKey('qq_self_openid','A'))).toBe('contact');expect(values.get(channelProcessedKey('qq_self_openid','B'))).toBe('contact');expect(values.has('qq_self_openid')).toBe(false);}
});
