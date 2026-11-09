import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createChannelReplyTransport } from './channelReply.js';
import { SendExecutionDeniedError } from '../tooling/sendApproval.js';
const live=vi.hoisted(()=>({account:'A',binding:'session-A',send:vi.fn(async(..._args:any[])=>({ok:true})),get:vi.fn()}));
vi.mock('../qq/qqService.js',()=>({getQQConnection:()=>({getSendIdentity:()=>({accountId:live.account,label:'fixture',binding:live.binding})}),sendQQMessage:live.send}));
vi.mock('../telegram/telegramService.js',()=>({getTelegramConnection:()=>({getSendIdentity:()=>({accountId:live.account,label:'fixture',binding:live.binding})}),sendTelegramMessage:live.send}));
vi.mock('../discord/discordService.js',()=>({getDiscordConnection:()=>({getSendIdentity:()=>({accountId:live.account,label:'fixture',binding:live.binding})}),sendDiscordMessage:live.send}));
vi.mock('../slack/slackService.js',()=>({getSlackConnection:()=>({getSendIdentity:()=>({accountId:live.account,label:'fixture',binding:live.binding})}),sendSlackMessage:live.send}));
vi.mock('../whatsapp/whatsappService.js',()=>({getWhatsAppConnection:()=>({getSendIdentity:()=>({accountId:live.account,label:'fixture',binding:live.binding})}),sendWhatsAppMessage:live.send}));
const raw=JSON.stringify({enabled:true,botToken:'fixture-token'}), configDigest=createHash('sha256').update(raw).digest('hex');
afterEach(()=>{live.account='A';live.binding='session-A';vi.clearAllMocks();});
it.each(['qq','telegram','discord','slack','whatsapp'] as const)('%s forwards a fresh runtime binding for the original account only',async channel=>{
  const transport=createChannelReplyTransport(async()=>raw), address={channel,accountId:'A',target:'peer',targetType:'private' as const,thread:'thread',configDigest};
  live.account='B';await expect(transport.send('owner',address,'reply')).rejects.toBeInstanceOf(SendExecutionDeniedError);expect(live.send).not.toHaveBeenCalled();
  live.account='A';live.binding='reconnected-A';expect(await transport.send('owner',address,'reply')).toBe(true);
  expect(live.send.mock.calls[0].at(-1)).toBe('reconnected-A');
  if(channel==='slack')expect(live.send.mock.calls[0][4]).toBe('thread');
});
it('rejects legacy/unidentified source accounts before a transport is invoked',async()=>{
  const transport=createChannelReplyTransport(async()=>raw);
  for(const accountId of [undefined,''])await expect(transport.validate('owner',{channel:'telegram',target:'peer',configDigest,accountId})).rejects.toBeInstanceOf(SendExecutionDeniedError);
  await expect(transport.validate('owner',{channel:'telegram',target:'peer',configDigest,accountId:'A',legacyUnbound:true})).rejects.toBeInstanceOf(SendExecutionDeniedError);
  expect(live.send).not.toHaveBeenCalled();
});
it('blocks an account change during the delivery claim check',async()=>{
  const transport=createChannelReplyTransport(async()=>raw);
  await expect(transport.send('owner',{channel:'telegram',target:'peer',configDigest,accountId:'A'},'reply',async()=>{live.account='B';})).rejects.toBeInstanceOf(SendExecutionDeniedError);
  expect(live.send).not.toHaveBeenCalled();
});
it('rejects disabled or changed settings without sending',async()=>{
  for(const value of ['{}','invalid',JSON.stringify({enabled:false}),JSON.stringify({enabled:true,botToken:'changed'})])await expect(createChannelReplyTransport(async()=>value).validate('owner',{channel:'telegram',target:'peer',configDigest,accountId:'A'})).rejects.toBeInstanceOf(SendExecutionDeniedError);
  expect(live.send).not.toHaveBeenCalled();
});
