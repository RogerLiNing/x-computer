import { EventEmitter } from 'node:events';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { AppDatabase } from '../db/database.js';

const COOKIE = 'x_session';
export const PASSWORD_RESET_KEY='auth_password_reset_v1';
interface CredentialProof {email:string;passwordHash:string;}
const LIFETIME = 7 * 24 * 60 * 60 * 1000;
const keyOf = (token: string) => `auth_session:${createHash('sha256').update(token).digest('hex')}`;

/** Opaque sessions are checked against server storage; user IDs alone grant no access. */
export class SessionAuth extends EventEmitter {
  private readonly cookie = process.env.X_COMPUTER_ISOLATED === '1'
    ? `${COOKIE}_isolated_${createHash('sha256').update(process.env.X_COMPUTER_WORKSPACE ?? '').digest('hex').slice(0,16)}`
    : COOKIE;
  constructor(private db: Pick<AppDatabase, 'getConfig' | 'setConfig'> & Partial<Pick<AppDatabase,'query'>>) {super();}
  private async credentialVersion(userId:string,proof?:CredentialProof){
    if(!this.db.query){if(proof)throw new Error('登录凭据验证暂不可用');return undefined;}
    const rows=await this.db.query<{email:string;password_hash:string}>('SELECT email,password_hash FROM auth_accounts WHERE user_id=? ORDER BY email',[userId]);
    if(proof&&!rows.some(row=>row.email===proof.email.trim().toLowerCase()&&row.password_hash===proof.passwordHash))throw new Error('密码已更新，请使用新密码重新登录');
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }
  credentialsChanged(userId:string){this.emit('credentials_changed',userId);}
  async createCookie(userId: string,proof?:CredentialProof): Promise<string> {
    const credentialVersion=await this.credentialVersion(userId,proof);
    const token = `${userId}.${randomBytes(32).toString('base64url')}`;
    await this.db.setConfig(userId, keyOf(token), JSON.stringify({ expiresAt: Date.now() + LIFETIME,credentialVersion }));
    return `${this.cookie}=${token}`;
  }
  async login(req: Request, res: Response, userId: string,proof?:CredentialProof): Promise<void> {
    const cookie = await this.createCookie(userId,proof);
    const previous=await this.authenticate(req.headers.cookie);
    if(previous){await this.db.setConfig(previous.userId,keyOf(previous.token),'revoked');this.emit('revoked',previous.token);}
    res.append('Set-Cookie', `${cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${LIFETIME / 1000}${req.secure || process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  }
  async authenticate(cookie?: string): Promise<{userId: string; expiresAt:number; token:string} | null> {
    const token = cookie?.split(';').map(p=>p.trim()).find(p=>p.startsWith(`${this.cookie}=`))?.slice(this.cookie.length+1);
    if (!token || !/^[\w-]{1,128}\.[\w-]{43}$/.test(token)) return null;
    const userId = token.slice(0,token.indexOf('.'));
    const raw = await this.db.getConfig(userId,keyOf(token));
    if (!raw) return null;
    let data:{expiresAt?:unknown;credentialVersion?:unknown};
    try {data=JSON.parse(raw);if(!data||typeof data!=='object'||Array.isArray(data))return null;}catch{return null;}
    const {expiresAt,credentialVersion}=data;if(typeof expiresAt!=='number'||expiresAt<=Date.now())return null;
    if(credentialVersion!==undefined){if(typeof credentialVersion!=='string'||credentialVersion!==await this.credentialVersion(userId))return null;}
    else if(await this.db.getConfig(userId,PASSWORD_RESET_KEY))return null;
    return {userId,expiresAt,token};
  }
  async logout(req:Request,res:Response):Promise<void> {
    const session=await this.authenticate(req.headers.cookie);
    if(session){await this.db.setConfig(session.userId,keyOf(session.token),'revoked');this.emit('revoked',session.token);}
    res.append('Set-Cookie',`${this.cookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  }
}

export function serviceTokenMatches(value: unknown): boolean {
  const expected=process.env.WORKFLOW_SERVICE_TOKEN;
  if(!expected || expected.length<32 || typeof value!=='string')return false;
  const actual=Buffer.from(value);const wanted=Buffer.from(`Bearer ${expected}`);
  return actual.length===wanted.length && timingSafeEqual(actual,wanted);
}
