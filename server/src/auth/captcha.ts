/**
 * 简单数学验证码：服务端生成题目，客户端提交答案，用于防止自动化暴力破解。
 */

const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const TTL_MS = 5 * 60 * 1000; // 5 分钟有效

interface CaptchaEntry {
  answer: number;
  expires: number;
}

const store = new Map<string, CaptchaEntry>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [id, entry] of store.entries()) {
    if (entry.expires < now) store.delete(id);
  }
}

export function createCaptcha(): { id: string; question: string } {
  pruneExpired();
  const a = digits[Math.floor(Math.random() * digits.length)];
  const b = digits[Math.floor(Math.random() * digits.length)];
  const id = `cap-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const answer = a + b;
  store.set(id, { answer, expires: Date.now() + TTL_MS });
  return { id, question: `${a} + ${b} = ?` };
}

export function verifyCaptcha(id: string, answer: string): boolean {
  const entry = store.get(id);
  if (!entry) return false;
  store.delete(id); // 一次性使用
  if (entry.expires < Date.now()) return false;
  const n = parseInt(String(answer).trim(), 10);
  return !Number.isNaN(n) && n === entry.answer;
}
