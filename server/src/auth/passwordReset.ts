import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {AsyncDatabase} from '../db/database.js';
import {hashPassword} from './password.js';
import {PASSWORD_RESET_KEY} from './sessionAuth.js';
import {sendSystemEmail} from '../email/emailService.js';
import {serverLogger} from '../observability/ServerLogger.js';
import {loadDefaultConfig} from '../config/defaultConfig.js';

export function passwordResetAvailable(){
 const smtp=loadDefaultConfig().email?.smtp;
 return typeof smtp?.host==='string'&&smtp.host.trim().length>0;
}

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
/** One active, hashed reset token per email; conditional writes serialize claims across instances. */
export class PasswordResetService {
 private ready:Promise<void>;
 private sqlite:boolean;
 private clock:string;
 constructor(private db:AsyncDatabase,private changed?:(userId:string)=>void){
  this.sqlite=db.getDialect()==='sqlite';
  this.clock=this.sqlite?"CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)":'CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS SIGNED)';
  this.ready=db.run(`CREATE TABLE IF NOT EXISTS password_reset_requests(email_hash VARCHAR(64) PRIMARY KEY,user_id VARCHAR(128) NOT NULL,code_hash VARCHAR(64) NOT NULL,claim_token VARCHAR(64) NOT NULL,used INTEGER NOT NULL DEFAULT 0,expires_at BIGINT NOT NULL,next_send_at BIGINT NOT NULL)${this.sqlite?'':' ENGINE=InnoDB'}`).then(()=>{});
  void this.ready.catch(()=>serverLogger.warn('auth/password-reset','找回密码存储暂不可用'));
 }
 async requestPasswordReset(value:string):Promise<{code:string;success:boolean}>{
  await this.ready;const email=value.trim().toLowerCase(),id=digest(email);
  const user=await this.db.queryOne<{user_id:string}>('SELECT user_id FROM auth_accounts WHERE email=?',[email]);
  if(!user)return{code:'',success:true};
  const code=randomBytes(24).toString('base64url'),claim=randomUUID();
  await this.db.run(`${this.sqlite?'INSERT OR IGNORE':'INSERT IGNORE'} INTO password_reset_requests(email_hash,user_id,code_hash,claim_token,expires_at,next_send_at) VALUES(?,?,'','',0,0)`,[id,user.user_id]);
  await this.db.run(`UPDATE password_reset_requests SET user_id=?,code_hash=?,claim_token=?,used=0,expires_at=${this.clock}+900000,next_send_at=${this.clock}+60000 WHERE email_hash=? AND next_send_at<=${this.clock}`,[user.user_id,digest(code),claim,id]);
  const saved=await this.db.queryOne<{claim_token:string}>('SELECT claim_token FROM password_reset_requests WHERE email_hash=?',[id]);
  if(saved?.claim_token!==claim)return{code:'',success:true};
  // shortcut: SMTP is best effort; add a durable mail outbox before guaranteeing delivery.
  void sendSystemEmail({to:email,subject:'X-Computer 密码重置码',body:`请复制下面的完整重置码，15 分钟内有效：\n\n${code}\n\n如果不是您本人操作，请忽略此邮件。`,html:false}).then(result=>{if(!result.ok)serverLogger.warn('auth/password-reset','重置邮件待用户重试');}).catch(()=>serverLogger.warn('auth/password-reset','重置邮件待用户重试'));
  return{code:'',success:true};
 }
 async resetPassword(value:string,code:string,newPassword:string):Promise<boolean>{
  await this.ready;const email=value.trim().toLowerCase(),id=digest(email),claim=randomUUID();
  await this.db.run(`UPDATE password_reset_requests SET used=1,claim_token=? WHERE email_hash=? AND code_hash=? AND used=0 AND expires_at>${this.clock}`,[claim,id,digest(code)]);
  const row=await this.db.queryOne<{user_id:string;claim_token:string;used:number}>('SELECT user_id,claim_token,used FROM password_reset_requests WHERE email_hash=?',[id]);
  if(row?.claim_token!==claim||Number(row.used)!==1)return false;
  const passwordHash=await hashPassword(newPassword);
  await this.db.setConfig(row.user_id,PASSWORD_RESET_KEY,'1');
  await this.db.run(`UPDATE auth_accounts SET password_hash=? WHERE email=? AND user_id=? AND EXISTS(SELECT 1 FROM password_reset_requests WHERE email_hash=? AND claim_token=? AND used=1 AND expires_at>${this.clock})`,[passwordHash,email,row.user_id,id,claim]);
  const saved=await this.db.queryOne<{password_hash:string}>('SELECT password_hash FROM auth_accounts WHERE email=?',[email]);
  if(saved?.password_hash!==passwordHash)return false;
  this.changed?.(row.user_id);
  void sendSystemEmail({to:email,subject:'X-Computer 密码已更新',body:'您的密码已更新，旧登录会话已失效。请使用新密码重新登录。如非本人操作，请立即联系网站管理员。',html:false}).then(result=>{if(!result.ok)serverLogger.warn('auth/password-reset','密码更新通知待用户核查');}).catch(()=>serverLogger.warn('auth/password-reset','密码更新通知待用户核查'));
  return true;
 }
}
