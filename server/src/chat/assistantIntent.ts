export type AssistantIntent =
  | 'generate_image'
  | 'generate_and_save_to_editor'
  | 'save_to_editor'
  | 'edit_current_document'
  | 'normal_chat'
  | 'create_task';

export interface AssistantIntentResult {
  intent: AssistantIntent;
  suggestedPath?: string;
  source: 'rules';
}

const IMAGE_REQUEST_PATTERN =
  /(?:生成|画|绘制|制作|创建).{0,10}(?:图片|图像|插画|海报|头像)|(?:图片|图像|插画|海报|头像).{0,10}(?:生成|画|绘制|制作|创建)|\b(?:generate|create|draw)\s+(?:an?\s+)?(?:image|picture|illustration|poster|avatar)\b/i;
const SAVE_ACTION_PATTERN = /保存|写入|存到|存入|导出到|放到|同步到/i;
const FILE_TOOL_PATTERN = /文件工具|文件系统|file\.write|真正写入文件|实际写入文件|写入磁盘|落盘/i;
const EDITOR_PATTERN = /编辑器/i;
const EDIT_DOCUMENT_PATTERN = /修改|改写|重写|润色|补充|扩写|缩写|删减|删除|调整|优化|替换|改成/i;
const CURRENT_DOCUMENT_PATTERN = /当前|现有|这个|这份|本文|文档|内容|标题|这一段|这段|上面|刚才/i;
const EXPLICIT_TASK_PATTERN =
  /(?:创建|新建|建立|加入|添加).{0,8}(?:任务|待办)|(?:作为|设为).{0,6}(?:任务|待办)|(?:后台|持续).{0,8}(?:执行|运行|跟进|处理)/i;
const SPECIAL_INTENT_HINT_PATTERN =
  /图片|图像|插画|海报|头像|编辑器|文档\/|保存|写入|修改|改写|润色|补充|删减|创建任务|新建任务|后台执行|持续跟进/i;

function extractSuggestedPath(message: string): string | undefined {
  const sandboxPath = message.match(/文档\/[^\s"'“”‘’，。；;！？!?]+/i)?.[0];
  if (sandboxPath) return sandboxPath.replace(/^\/+/, '');

  const fileName = message.match(
    /(?:^|[\s"'“”‘’])([^\s"'“”‘’，。；;！？!?/\\]+\.(?:txt|md|markdown|doc|docx|rtf|html|json|csv))\b/i,
  )?.[1];
  return fileName ? `文档/${fileName}` : undefined;
}

/**
 * 对高置信度意图进行零模型路由。
 * 返回 null 表示存在特殊意图信号但规则无法安全判断，应交给模型分类。
 */
export function classifyAssistantIntentFast(
  userMessage: string,
  hasOpenAiDocument: boolean,
): AssistantIntentResult | null {
  const message = userMessage.trim();
  if (!message) return { intent: 'normal_chat', source: 'rules' };

  if (IMAGE_REQUEST_PATTERN.test(message)) {
    return { intent: 'generate_image', source: 'rules' };
  }

  if (FILE_TOOL_PATTERN.test(message)) {
    return { intent: 'normal_chat', source: 'rules' };
  }

  if (extractSuggestedPath(message) && SAVE_ACTION_PATTERN.test(message)) {
    return { intent: 'normal_chat', source: 'rules' };
  }

  if (SAVE_ACTION_PATTERN.test(message) && EDITOR_PATTERN.test(message)) {
    return { intent: 'save_to_editor', source: 'rules' };
  }

  if (
    hasOpenAiDocument &&
    EDIT_DOCUMENT_PATTERN.test(message) &&
    CURRENT_DOCUMENT_PATTERN.test(message)
  ) {
    return { intent: 'edit_current_document', source: 'rules' };
  }

  if (EXPLICIT_TASK_PATTERN.test(message)) {
    return { intent: 'create_task', source: 'rules' };
  }

  if (SPECIAL_INTENT_HINT_PATTERN.test(message)) return null;
  return { intent: 'normal_chat', source: 'rules' };
}
