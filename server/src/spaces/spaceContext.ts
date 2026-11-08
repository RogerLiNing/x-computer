import { serverLogger } from '../observability/ServerLogger.js';
import type { SpaceStore, SpaceSummary } from './SpaceStore.js';

type SpaceLister = Pick<SpaceStore, 'listSpacesForUser'>;

const EMPTY_CONTEXT = '# 共享空间\n你目前不在任何共享空间。用户想和别人共享资料时，可以用 x.space_create 建一个空间，再用 x.space_invite 生成邀请码。';

const MAX_LABEL_LENGTH = 30;

/** 名称由用户填写，进入他人的提示词前去掉换行和控制字符并截断，避免夹带多行指令。 */
export function sanitizeLabel(value: string): string {
  const flat = String(value ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  return chars.length > MAX_LABEL_LENGTH ? `${chars.slice(0, MAX_LABEL_LENGTH).join('')}…` : flat;
}

function describeSpace(space: SpaceSummary, userId: string): string {
  const members = space.members
    .map(m => `${sanitizeLabel(m.displayName)}${m.userId === userId ? '（你）' : ''}${m.role === 'owner' ? '·创建者' : ''}`)
    .join('、');
  return `- 「${sanitizeLabel(space.name)}」（id: ${space.id}，${space.members.length} 人）成员：${members}`;
}

/** 拼进系统提示词的空间信息。查询失败时返回空字符串，不影响对话。 */
export async function buildSpaceContext(store: SpaceLister, userId: string): Promise<string> {
  try {
    const spaces = await store.listSpacesForUser(userId);
    if (spaces.length === 0) return EMPTY_CONTEXT;
    return [
      '# 共享空间',
      '用户所在的共享空间如下。空间成员各有自己的助手，私人对话和私人记忆互不可见。',
      ...spaces.map(space => describeSpace(space, userId)),
      '用户问起空间、成员或邀请时，按以上信息回答，需要操作时用 x.space_* 工具。空间里的共享文件、记忆和日程还在开发中，暂时不要承诺这些功能。',
    ].join('\n');
  } catch (error) {
    serverLogger.warn('spaces', '读取空间信息失败，本轮对话不带空间上下文', `userId=${userId} ${String(error)}`);
    return '';
  }
}
