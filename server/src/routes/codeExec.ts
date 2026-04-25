import { Router } from 'express';
import type { SandboxShell } from '../tooling/SandboxShell.js';
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import type { AppDatabase } from '../db/database.js';
import type { ChatMessageRow } from '../db/database.js';

async function getUserShell(
  req: Express.Request,
  defaultShell: SandboxShell,
  manager?: UserSandboxManager,
): Promise<SandboxShell> {
  if (manager && req.userId && req.userId !== 'anonymous') {
    const sandbox = await manager.getForUser(req.userId);
    return sandbox.sandboxShell;
  }
  return defaultShell;
}

export function createCodeExecRouter(shell: SandboxShell, userSandboxManager?: UserSandboxManager, db?: AppDatabase): Router {
  const router = Router();

  const EXECUTABLE = new Set(['python', 'python3', 'python2', 'bash', 'sh', 'shell', 'js', 'javascript', 'node']);

  function wrapCommand(lang: string, code: string): string {
    switch (lang) {
      case 'python':
      case 'python3':
      case 'python2':
        return `python3 << 'XEOF'\n${code}\nXEOF`;
      case 'js':
      case 'javascript':
      case 'node':
        return `node << 'XEOF'\n${code}\nXEOF`;
      case 'bash':
      case 'sh':
      case 'shell':
        return code;
      default:
        return code;
    }
  }

  /** POST /api/code/exec — Execute code in the sandbox and return stdout/stderr/exitCode */
  router.post('/exec', async (req, res) => {
    try {
      const sh = await getUserShell(req, shell, userSandboxManager);
      const { code, language = 'bash' } = req.body ?? {};

      if (typeof code !== 'string' || !code.trim()) {
        res.status(400).json({ error: 'Missing code' });
        return;
      }

      if (!EXECUTABLE.has(language.toLowerCase())) {
        res.status(400).json({ error: `Language '${language}' is not executable` });
        return;
      }

      const command = wrapCommand(language.toLowerCase(), code.trim());
      const result = await sh.execute(command);
      res.json({
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        exitCode: result.exitCode ?? 0,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  /** POST /api/code/chat-export-pdf — Generate a PDF from a chat session */
  if (db) {
    router.post('/chat-export-pdf', async (req, res) => {
      try {
        const { sessionId } = req.body ?? {};
        if (!sessionId || typeof sessionId !== 'string') {
          res.status(400).json({ error: 'Missing sessionId' });
          return;
        }

        // Get session and verify ownership
        const session = await db.getSession(sessionId);
        if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
        if (session.user_id !== req.userId) { res.status(403).json({ error: 'Forbidden' }); return; }

        const messages = await db.getMessages(sessionId, 2000);
        const sh = await getUserShell(req, shell, userSandboxManager);

        const safeTitle = (session.title || 'Conversation').replace(/'/g, "\\'").replace(/\n/g, ' ');
        const exportDate = new Date().toLocaleString();
        const msgsJson = JSON.stringify(messages.map((m: ChatMessageRow) => ({
          role: m.role,
          content: m.content || '',
          toolCalls: m.tool_calls_json ? JSON.parse(m.tool_calls_json) : [],
          created_at: m.created_at,
        })));

        const pdfScript = `
import sys
try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
except ImportError:
    print("ERROR:reportlab_not_installed")
    sys.exit(1)

import io, base64, json
from datetime import datetime

msgs = json.loads('''${msgsJson}''')

buffer = io.BytesIO()
doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=2*cm, rightMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
styles = getSampleStyleSheet()

title_style = ParagraphStyle('Title', parent=styles['Title'], fontSize=16, spaceAfter=10, textColor=colors.HexColor('#1a1a2e'))
meta_style = ParagraphStyle('Meta', parent=styles['Normal'], fontSize=9, textColor=colors.HexColor('#888888'), spaceAfter=20)
role_user_style = ParagraphStyle('RoleUser', parent=styles['Normal'], fontSize=10, textColor=colors.HexColor('#3b82f6'), fontName='Helvetica-Bold', spaceAfter=4)
role_asst_style = ParagraphStyle('RoleAsst', parent=styles['Normal'], fontSize=10, textColor=colors.HexColor('#10b981'), fontName='Helvetica-Bold', spaceAfter=4)
content_style = ParagraphStyle('Content', parent=styles['Normal'], fontSize=9, leading=14, textColor=colors.HexColor('#333333'), spaceAfter=12)
tool_style = ParagraphStyle('Tool', parent=styles['Normal'], fontSize=8, textColor=colors.HexColor('#999999'), fontName='Helvetica-Oblique')

elements = []
elements.append(Paragraph('${safeTitle}', title_style))
elements.append(Paragraph('Export date: ${exportDate} | X-Computer', meta_style))
elements.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#e5e5e5'), spaceAfter=12))

for m in msgs:
    role = m['role']
    content = m['content'] or ''
    tool_calls = m.get('toolCalls', []) or []
    created = m.get('created_at', '')
    try:
        time_str = datetime.fromisoformat(created.replace('Z', '+00:00')).strftime('%Y-%m-%d %H:%M')
    except:
        time_str = str(created)[:16]

    role_label = 'User' if role == 'user' else 'Assistant'
    role_style = role_user_style if role == 'user' else role_asst_style

    elements.append(Paragraph(f'{role_label}  · {time_str}', role_style))

    safe_content = content.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    elements.append(Paragraph(safe_content, content_style))

    if tool_calls:
        tool_names = ', '.join(str(t.get('name', '')) for t in tool_calls if t.get('name'))
        elements.append(Paragraph(f'[Tools: {tool_names}]', tool_style))

    elements.append(Spacer(1, 8))

elements.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#e5e5e5'), spaceBefore=12))
elements.append(Paragraph('Exported from X-Computer', meta_style))

doc.build(elements)
data = buffer.getvalue()
sys.stdout.write(base64.b64encode(data).decode('ascii'))
`.trim();

        const result = await sh.execute(`python3 << 'XEOF'\n${pdfScript}\nXEOF`);
        if (result.exitCode !== 0) {
          if (result.stdout?.includes('ERROR:reportlab_not_installed')) {
            res.status(500).json({ error: 'PDF library not installed. Install with: pip install reportlab' });
            return;
          }
          res.status(500).json({ error: 'PDF generation failed', detail: result.stderr || result.stdout });
          return;
        }

        const pdfBuffer = Buffer.from(result.stdout.trim(), 'base64');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="conversation-${sessionId}.pdf"`);
        res.setHeader('Content-Length', String(pdfBuffer.length));
        res.end(pdfBuffer);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: msg });
      }
    });
  }

  return router;
}
