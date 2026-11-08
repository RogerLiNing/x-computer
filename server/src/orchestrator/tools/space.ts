import type { ToolDefinition } from '@x-computer/shared';
import { getSpaceStore, type SpaceDb, type SpaceSummary } from '../../spaces/SpaceStore.js';
import type { ToolHandler } from './types.js';

const base: Pick<ToolDefinition, 'domain' | 'requiredPermissions'> = { domain: ['chat', 'agent'], requiredPermissions: [] };
const spaceParam: ToolDefinition['parameters'][number] = { name: 'space', type: 'string', description: '空间名称或空间 id', required: true };

export const spaceToolDefinitions: ToolDefinition[] = [
  { ...base, name: 'x.space_list', displayName: '查看我的共享空间', riskLevel: 'low',
    description: '列出用户所在的共享空间、成员和自己的身份。', parameters: [] },
  { ...base, name: 'x.space_create', displayName: '创建共享空间', riskLevel: 'low',
    description: '创建一个共享空间，用户成为创建者。用户明确要建空间时才调用。',
    parameters: [{ name: 'name', type: 'string', description: '空间名，1 到 40 个字', required: true }] },
  { ...base, name: 'x.space_invite', displayName: '生成空间邀请码', riskLevel: 'low',
    description: '为空间生成一次性邀请码，24 小时内有效。只有创建者可以生成。把邀请码原样告诉用户，由用户转给对方。',
    parameters: [spaceParam] },
  { ...base, name: 'x.space_join', displayName: '用邀请码加入空间', riskLevel: 'low',
    description: '用户提供邀请码时，用它加入对应的共享空间。',
    parameters: [{ name: 'code', type: 'string', description: '8 位邀请码', required: true }] },
  { ...base, name: 'x.space_leave', displayName: '退出共享空间', riskLevel: 'medium',
    description: '用户明确要求退出时才调用。创建者退出后由最早加入的成员接任；最后一人退出时空间会被删除。',
    parameters: [spaceParam] },
  { ...base, name: 'x.space_remove_member', displayName: '移除空间成员', riskLevel: 'medium',
    description: '创建者把某个成员移出空间。用户明确要求时才调用。',
    parameters: [spaceParam, { name: 'member', type: 'string', description: '成员显示名或成员 id', required: true }] },
];

export const SPACE_TOOL_NAMES: readonly string[] = spaceToolDefinitions.map(d => d.name);

function requireUser(context: unknown): string {
  const userId = (context as { userId?: string } | undefined)?.userId;
  if (!userId || userId === 'anonymous') throw new Error('请先登录后再使用共享空间');
  return userId;
}

function requireText(input: Record<string, unknown>, key: string, message: string): string {
  const value = typeof input[key] === 'string' ? input[key].trim() : '';
  if (!value) throw new Error(message);
  return value;
}

function present(space: SpaceSummary) {
  return {
    id: space.id,
    name: space.name,
    yourRole: space.role === 'owner' ? '创建者' : '成员',
    members: space.members.map(m => ({ id: m.userId, name: m.displayName, role: m.role === 'owner' ? '创建者' : '成员' })),
  };
}

function findMember(space: SpaceSummary, key: string): string {
  const byId = space.members.find(m => m.userId === key);
  if (byId) return byId.userId;
  const byName = space.members.filter(m => m.displayName === key);
  if (byName.length === 1) return byName[0].userId;
  if (byName.length > 1) throw new Error(`有多个成员叫「${key}」，请用成员 id 指定`);
  throw new Error(`「${space.name}」里没有叫「${key}」的成员`);
}

export function createSpaceHandlers(db: SpaceDb): Record<string, ToolHandler> {
  const store = getSpaceStore(db);
  const spaceOf = (userId: string, input: Record<string, unknown>) =>
    store.resolveSpace(userId, requireText(input, 'space', '请说明是哪个空间'));

  return {
    'x.space_list': async (_input, context) => {
      const spaces = await store.listSpacesForUser(requireUser(context));
      return { ok: true, spaces: spaces.map(present) };
    },
    'x.space_create': async (input, context) => {
      const space = await store.createSpace(requireUser(context), requireText(input, 'name', '请提供空间名'));
      return { ok: true, space: present(space), message: `已创建空间「${space.name}」。要邀请别人，可以生成邀请码。` };
    },
    'x.space_invite': async (input, context) => {
      const userId = requireUser(context);
      const space = await spaceOf(userId, input);
      const invite = await store.createInvite(userId, space.id);
      return { ok: true, code: invite.code, expiresAt: new Date(invite.expiresAt).toISOString(),
        message: `「${space.name}」的邀请码：${invite.code}。24 小时内有效，只能用一次。请把它转给对方，让对方发给自己的助手。` };
    },
    'x.space_join': async (input, context) => {
      const space = await store.joinByCode(requireUser(context), requireText(input, 'code', '请提供邀请码'));
      return { ok: true, space: present(space), message: `已加入空间「${space.name}」，现在共有 ${space.members.length} 人。` };
    },
    'x.space_leave': async (input, context) => {
      const userId = requireUser(context);
      const space = await spaceOf(userId, input);
      const result = await store.leaveSpace(userId, space.id);
      const message = result.deleted ? `已退出「${space.name}」。你是最后一位成员，空间已删除。` : `已退出「${space.name}」。`;
      return { ok: true, ...result, message };
    },
    'x.space_remove_member': async (input, context) => {
      const userId = requireUser(context);
      const space = await spaceOf(userId, input);
      const memberId = findMember(space, requireText(input, 'member', '请说明要移除哪位成员'));
      await store.removeMember(userId, space.id, memberId);
      return { ok: true, message: `已把该成员移出「${space.name}」。` };
    },
  };
}
