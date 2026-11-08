import { describe, expect, it } from 'vitest';
import {
  buildTextArtifactDeliveryInstruction,
  inspectTextArtifactCompletion,
  extractTextArtifactBody,
  resolveInitialLoadedTools,
  resolveIntentPreloadedTools,
  resolveRequestedTextArtifactPath,
  X_DIRECT_PRELOADED_TOOLS,
} from './xDirectToolPolicy.js';

describe('resolveInitialLoadedTools', () => {
  it('preloads shared space tools when the user talks about spaces or invite codes',()=>{
    expect(resolveIntentPreloadedTools('帮我建一个家庭空间')).toContain('x.space_create');
    expect(resolveIntentPreloadedTools('我的邀请码是 ABCD2345')).toContain('x.space_join');
    expect(resolveIntentPreloadedTools('写一首诗')).not.toContain('x.space_list');
  });
  it('preloads the pure reminder tool for reminder requests',()=>{
    expect(resolveInitialLoadedTools('normal_chat',undefined,'一分钟后提醒我整理书包')).toContain('x.schedule_reminder');expect(resolveIntentPreloadedTools('讲个故事')).not.toContain('x.schedule_reminder');
  });
  it('offers scheduled work from the main assistant without forcing it for normal writing', () => {
    expect(resolveInitialLoadedTools('normal_chat', undefined, '明天早上八点帮我生成报告')).toContain('x.schedule_run');
    expect(resolveInitialLoadedTools('normal_chat', undefined, '现在帮我写一份报告')).toBeUndefined();
  });
  it('loads fingerprint reading and XML copy edits for existing Office modification requests',()=>{
    expect(resolveIntentPreloadedTools('修改 报告.docx，把旧文字替换为新文字')).toEqual(expect.arrayContaining(['file.extract_text','office.edit_copy','file.present']));
    expect(resolveIntentPreloadedTools('修改 Excel 表格')).toContain('office.edit_copy');
    expect(resolveIntentPreloadedTools('讲一个故事')).not.toContain('office.edit_copy');
  });
  it('saves explicitly labelled document contents without invented file-operation commentary', () => {
    expect(extractTextArtifactBody('已保留原文件并保存修改版。\n修改版正文：\n```\n- [ ] 交办\n- [ ] 停止恢复\n- [ ] 成果确认\n```\n三行已保存。'))
      .toBe('- [ ] 交办\n- [ ] 停止恢复\n- [ ] 成果确认');
    expect(extractTextArtifactBody('研究报告包含代码示例\n```text\nexample\n```\n结论')).toContain('结论');
  });
  it('does not include the instruction sentence in an unquoted output path', () => {
    expect(resolveRequestedTextArtifactPath('这是验收任务，请写三条清单，保存到 文档/真实模型验收.md。不要联网。'))
      .toBe('文档/真实模型验收.md');
  });
  it('never treats input file references as a requested output',()=>{
    expect(resolveRequestedTextArtifactPath('找到 type=file 的“选择文件”框，再用 browser.request_upload 申请提供工作区文件 下载/input.txt，等待确认。')).toBeUndefined();
    expect(resolveRequestedTextArtifactPath('请阅读 文档/输入.md 并总结，不要保存文件。')).toBeUndefined();
    expect(resolveRequestedTextArtifactPath('读取 文档/输入.md，然后保存到 文档/输出.md。')).toBe('文档/输出.md');
    expect(resolveRequestedTextArtifactPath('不要保存到 文档/报告.md。')).toBeUndefined();
    expect(resolveRequestedTextArtifactPath('保存为“文档/我的 报告.md”')).toBe('文档/我的 报告.md');
    expect(resolveRequestedTextArtifactPath('保存到 ../outside.txt')).toBeUndefined();
  });
  it('preloads X core tools for x_direct conversations', () => {
    expect(resolveInitialLoadedTools('x_direct', undefined)).toEqual([
      ...X_DIRECT_PRELOADED_TOOLS,
    ]);
  });

  it('merges requested tools without duplicates', () => {
    expect(resolveInitialLoadedTools('x_direct', ['file.read', 'x.notify_user'])).toEqual([
      ...X_DIRECT_PRELOADED_TOOLS,
      'file.read',
    ]);
  });

  it('does not preload X tools for normal chat', () => {
    expect(resolveInitialLoadedTools('normal_chat', [' file.read ', null])).toEqual([
      'file.read',
    ]);
    expect(resolveInitialLoadedTools('normal_chat', undefined)).toBeUndefined();
  });

  it('preloads native Office tools from ordinary user wording', () => {
    expect(resolveIntentPreloadedTools('请制作一份 Word 文档，保存为 文档/指南.docx')).toEqual([
      'office.create_docx',
    ]);
    expect(resolveInitialLoadedTools(
      'normal_chat',
      undefined,
      '帮我做一个 6 页 PPT 演示稿',
    )).toEqual(['office.create_pptx']);
  });

  it('extracts an explicit text artifact path and builds delivery guidance', () => {
    const path = resolveRequestedTextArtifactPath(
      '把完整报告保存到“文档/普通用户端到端测试-AI电脑深度研究.md”，不要只给摘要。',
    );
    expect(path).toBe('文档/普通用户端到端测试-AI电脑深度研究.md');
    expect(buildTextArtifactDeliveryInstruction(path!)).toContain('不要调用 file.write');
    expect(buildTextArtifactDeliveryInstruction(path!)).toContain('6000 个中文字符以内');
    expect(buildTextArtifactDeliveryInstruction(path!)).toContain('Markdown 来源链接');
  });

  it.each(['正文不超过四十字', '全文 40 个字符以内', '写一段至多 40 字的说明'])('counts punctuation in total-length constraints: %s', request => {
    expect(inspectTextArtifactCompletion(request, '甲'.repeat(39) + '。').complete).toBe(true);
    expect(inspectTextArtifactCompletion(request, '甲'.repeat(40) + '。')).toMatchObject({ complete: false, rewrite: true });
    expect(inspectTextArtifactCompletion('每段不超过四十字', '甲'.repeat(80)).complete).toBe(true);
  });

  it('detects missing research sections and source links', () => {
    const request =
      '包含执行摘要、关键发现、主流平台对比、争议与局限、按低中高预算建议，至少6个来源链接';
    expect(inspectTextArtifactCompletion(request, '# 执行摘要\n已有内容')).toEqual({
      complete: false,
      missing: [
        '关键发现',
        '主流平台',
        '争议与局限',
        '低预算',
        '中预算',
        '高预算',
        '至少 6 个不同来源的 Markdown 链接（当前 0 个）',
      ],
    });
    const complete = [
      '# 执行摘要',
      '# 关键发现',
      '# 主流平台',
      '# 争议与局限',
      '# 低预算',
      '# 中预算',
      '# 高预算',
      ...Array.from({ length: 6 }, (_, index) => `[来源${index}](https://example.com/${index})`),
    ].join('\n');
    expect(inspectTextArtifactCompletion(request, complete).complete).toBe(true);
  });
});


describe('natural-language channel send discovery', () => {
  it.each([
    ['请通过 WhatsApp 给合成测试目标发送消息', 'x.send_whatsapp'],
    ['帮我用 Telegram 发给对方一条消息', 'x.send_telegram'],
    ['send a message on Slack', 'x.send_slack'],
    ['发送 Discord 频道消息', 'x.send_discord'],
    ['给 QQ 群发一条消息', 'x.send_qq'],
    ['请发邮件给验收邮箱', 'x.send_email'],
  ])('preloads the existing gated send tool: %s', (message, tool) => {
    expect(resolveIntentPreloadedTools(message)).toContain(tool);
  });
  it('does not treat a channel explanation as a send request and avoids duplicates', () => {
    expect(resolveIntentPreloadedTools('解释 WhatsApp 和 Slack 是什么')).toEqual([]);
    expect(resolveIntentPreloadedTools('调用 x.send_whatsapp 发送 WhatsApp 消息')).toEqual(['x.send_whatsapp']);
  });
});
