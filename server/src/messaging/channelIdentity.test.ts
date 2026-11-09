import { afterEach, expect, it, vi } from 'vitest';
import { createBoardHandlers } from '../orchestrator/tools/board.js';
import { getTelegramConnection, disconnectTelegram, setTelegramMessageHandler } from '../telegram/telegramService.js';
import { getDiscordConnection, disconnectDiscord, setDiscordMessageHandler } from '../discord/discordService.js';
import { getSlackConnection, disconnectSlack, setSlackMessageHandler } from '../slack/slackService.js';
import { getQQConnection, disconnectQQ, setQQMessageHandler } from '../qq/qqService.js';
import { SendApprovalRequiredError, SendExecutionDeniedError } from '../tooling/sendApproval.js';
import { UncertainToolOutcomeError } from '../tooling/UncertainToolOutcomeError.js';
const sdk = vi.hoisted(() => ({ account: 'bot-a', team: 'team-a', send: vi.fn(), resolveChannel: vi.fn(), authWait: vi.fn() }));
vi.mock('grammy', () => ({ Bot: class {
  on = vi.fn(); start = vi.fn(async () => {}); stop = vi.fn();
  api = { getMe: async () => { await sdk.authWait(); return { id: sdk.account, username: sdk.account }; }, sendMessage: sdk.send };
} }));
vi.mock('discord.js', () => ({ GatewayIntentBits: { Guilds: 1, GuildMessages: 2, DirectMessages: 3, MessageContent: 4 }, Client: class {
  on = vi.fn(); login = vi.fn(async () => { await sdk.authWait(); }); destroy = vi.fn();
  user = { id: sdk.account, username: sdk.account };
  channels = { fetch: async () => { await sdk.resolveChannel(); return { send: sdk.send }; } };
} }));
vi.mock('@slack/bolt', () => ({ App: class {
  message = vi.fn(); start = vi.fn(async () => {}); stop = vi.fn();
  client = { auth: { test: async () => { await sdk.authWait(); return { user_id: sdk.account, user: sdk.account, team_id: sdk.team, team: sdk.team }; } }, chat: { postMessage: sdk.send } };
} }));
vi.mock('qq-official-bot', () => ({ ReceiverMode: { WEBSOCKET: 'websocket' }, Bot: class {
  on = vi.fn(); start = vi.fn(async () => { await sdk.authWait(); }); stop = vi.fn();
  getSelfInfo = async () => ({ id: sdk.account, username: sdk.account });
  sendPrivateMessage = sdk.send; sendGroupMessage = sdk.send; sendGuildMessage = sdk.send;
} }));
const rawConfig = () => JSON.stringify({ enabled: true, dmPolicy: 'open', botToken: 'local-fixture-token', appToken: 'fixture-app', appId: 'fixture', secret: 'fixture-secret' });
let pendingConfig: Promise<string> | undefined;
const getConfig = () => pendingConfig ?? rawConfig();
const handlers = createBoardHandlers({ resolveDB: () => null, resolveFS: async () => undefined });
const context = { userId: 'owner', runId: 'run', toolCallId: 'call', getConfig, assertSendActive: async () => {} };
const channels = [
  { name: 'telegram', get: () => getTelegramConnection('owner', getConfig), connect: () => getTelegramConnection('owner', getConfig).connect('fixture-token'), disconnect: () => disconnectTelegram('owner'), handler: handlers.sendTelegramHandler, input: { chatId: 'target', message: '合成正文' } },
  { name: 'discord', get: () => getDiscordConnection('owner', getConfig), connect: () => getDiscordConnection('owner', getConfig).connect('fixture-token'), disconnect: () => disconnectDiscord('owner'), handler: handlers.sendDiscordHandler, input: { channelId: 'target', message: '合成正文' } },
  { name: 'slack', get: () => getSlackConnection('owner', getConfig), connect: () => getSlackConnection('owner', getConfig).connect('fixture-token', 'fixture-app'), disconnect: () => disconnectSlack('owner'), handler: handlers.sendSlackHandler, input: { channelId: 'target', message: '合成正文', threadTs: 'thread' } },
  { name: 'qq', get: () => getQQConnection('owner', getConfig), connect: () => getQQConnection('owner', getConfig).connect('fixture', 'fixture-secret'), disconnect: () => disconnectQQ('owner'), handler: handlers.sendQQHandler, input: { targetType: 'private', targetId: 'target', message: '合成正文' } },
];
async function proposal(channel: typeof channels[number], extra = {}) {
  try { await channel.handler(channel.input, { ...context, ...extra }); } catch (error) {
    expect(error).toBeInstanceOf(SendApprovalRequiredError); return (error as SendApprovalRequiredError).request;
  }
  throw new Error('Expected a pending approval');
}
afterEach(() => { channels.forEach(channel => channel.disconnect()); sdk.account = 'bot-a'; sdk.team = 'team-a'; pendingConfig=undefined; [setTelegramMessageHandler,setDiscordMessageHandler,setSlackMessageHandler,setQQMessageHandler].forEach(set=>set(()=>{})); vi.resetAllMocks(); vi.useRealTimers(); });
for (const channel of channels) {
  it(`${channel.name}: a late failure of an older login cannot clear the new identity`, async () => {
    let reject!: (error: Error) => void;
    sdk.authWait.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const old = channel.connect(); await vi.waitFor(() => expect(sdk.authWait).toHaveBeenCalledOnce());
    sdk.account = 'bot-b'; await channel.connect(); reject(new Error('old login failed'));
    await old; expect(channel.get().getSendIdentity()?.accountId).toContain('bot-b');
  });
  it(`${channel.name}: refuses to propose a sender whose identity was not verified`, async () => {
    sdk.account = ''; await channel.connect();
    await expect(channel.handler(channel.input, context)).rejects.toBeInstanceOf(SendExecutionDeniedError); expect(sdk.send).not.toHaveBeenCalled();
  });
  it(`${channel.name}: re-confirms a changed sender and sends once with the new account`, async () => {
    await channel.connect(); const first = await proposal(channel);
    expect(first.sender?.accountId).toContain('bot-a'); expect(JSON.stringify(first)).not.toContain('fixture-secret');
    channel.disconnect(); sdk.account = 'bot-b'; await channel.connect();
    const next = await proposal(channel, { approvedSendHash: first.hash });
    expect(next.hash).not.toBe(first.hash); expect(next.sender?.accountId).toContain('bot-b'); expect(sdk.send).not.toHaveBeenCalled();
    await channel.handler(channel.input, { ...context, approvedSendHash: next.hash }); expect(sdk.send).toHaveBeenCalledOnce();
    if (channel.name === 'slack') expect(sdk.send).toHaveBeenCalledWith({ channel: 'target', text: '合成正文', thread_ts: 'thread' });
  });
  it(`${channel.name}: a new connection of the same account invalidates the old permission`, async () => {
    await channel.connect(); const first = await proposal(channel); channel.disconnect(); await channel.connect();
    expect((await proposal(channel, { approvedSendHash: first.hash })).hash).not.toBe(first.hash); expect(sdk.send).not.toHaveBeenCalled();
  });
  it(`${channel.name}: blocks disconnect during the last permission check before transport`, async () => {
    await channel.connect(); const first = await proposal(channel);
    await expect(channel.handler(channel.input, { ...context, approvedSendHash: first.hash, assertSendActive: async () => channel.disconnect() })).rejects.toBeInstanceOf(SendExecutionDeniedError);
    expect(sdk.send).not.toHaveBeenCalled();
  });
  it(`${channel.name}: an uncertain transport receipt is never retried`, async () => {
    await channel.connect(); const first = await proposal(channel); sdk.send.mockRejectedValueOnce(new Error('response lost'));
    await expect(channel.handler(channel.input, { ...context, approvedSendHash: first.hash })).rejects.toBeInstanceOf(UncertainToolOutcomeError);
    expect(sdk.send).toHaveBeenCalledOnce();
  });
}
it('Slack separates the same bot user across workspaces', async () => {
  const slack = channels.find(channel => channel.name === 'slack')!;
  await slack.connect(); const first = await proposal(slack); slack.disconnect(); sdk.team = 'team-b'; await slack.connect();
  const next = await proposal(slack, { approvedSendHash: first.hash });
  expect(next.sender?.accountId).not.toBe(first.sender?.accountId); expect(next.sender?.accountId).toContain('team-b'); expect(sdk.send).not.toHaveBeenCalled();
});
it('Discord rechecks identity after resolving the destination channel', async () => {
  const discord = channels.find(channel => channel.name === 'discord')!;
  await discord.connect(); const first = await proposal(discord); sdk.resolveChannel.mockImplementationOnce(async () => discord.disconnect());
  await expect(discord.handler(discord.input, { ...context, approvedSendHash: first.hash })).rejects.toBeInstanceOf(SendExecutionDeniedError);
  expect(sdk.send).not.toHaveBeenCalled();
});


it('QQ isolates the deadline of an older login from the new active connection', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const qq = channels.find(channel => channel.name === 'qq')!; let release!: () => void;
  sdk.authWait.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const old = qq.connect(); expect(sdk.authWait).toHaveBeenCalledOnce();
  sdk.account = 'bot-b'; await qq.connect(); vi.advanceTimersByTime(10000); release(); await old;
  expect(qq.get().getSendIdentity()?.accountId).toContain('bot-b');
});


for (const channel of channels) it(`${channel.name}: pins incoming origin before an asynchronous configuration lookup`, async () => {
  const received=vi.fn();
  ({telegram:setTelegramMessageHandler,discord:setDiscordMessageHandler,slack:setSlackMessageHandler,qq:setQQMessageHandler})[channel.name as 'telegram'](received);
  await channel.connect(); const connection:any=channel.get(), original=connection.getSendIdentity().accountId;
  let release!:(raw:string)=>void; pendingConfig=new Promise<string>(resolve=>{release=resolve;});
  let callback:any, payload:any;
  if(channel.name==='telegram'){callback=connection.bot.on.mock.calls.find((call:any[])=>call[0]==='message:text')[1];payload={message:{from:{id:99,username:'Peer'},chat:{id:99,type:'private'},text:'合成入站',message_id:1,date:1}};}
  else if(channel.name==='discord'){callback=connection.client.on.mock.calls.find((call:any[])=>call[0]==='messageCreate')[1];payload={author:{bot:false,id:'peer',tag:'Peer'},channelId:'room',content:'合成入站',id:'event',createdTimestamp:1000};}
  else if(channel.name==='slack'){callback=connection.app.message.mock.calls[0][0];payload={message:{user:'peer',text:'合成入站',channel:'room',channel_type:'im',ts:'1.1'}};}
  else{callback=connection.bot.on.mock.calls.find((call:any[])=>call[0]==='message.private.friend')[1];payload={user_id:'peer',sender:{user_name:'Peer'},raw_message:'合成入站',message_id:'event'};}
  const event=callback(payload);
  if(channel.name==='slack')connection.botUserId='bot-b';else connection.botInfo={id:'bot-b',username:'New account'};
  release(rawConfig()); await event; pendingConfig=undefined;
  expect(received).toHaveBeenCalledOnce();const origin=received.mock.calls[0][1].origin;
  expect(origin.accountId).toBe(original);expect(origin.scopeId).toBe(original);expect(origin.configDigest).toMatch(/^[a-f0-9]{64}$/);
});
