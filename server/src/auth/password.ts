import crypto from 'crypto';

const SALT_BYTES = 16;
const KEY_LEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LEN, SCRYPT_OPTIONS, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

/** 生成存储用字符串：saltHex.hashHex */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = await scryptAsync(password, salt);
  return `${salt.toString('hex')}.${hash.toString('hex')}`;
}

/** 验证密码是否与存储的 hash 匹配 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('.');
  if (parts.length !== 2) return false;
  const [saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  if (salt.length !== SALT_BYTES) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(password, salt);
  return crypto.timingSafeEqual(expected, actual);
}
