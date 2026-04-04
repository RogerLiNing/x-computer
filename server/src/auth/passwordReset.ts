/**
 * 密码重置服务
 */

import type { AsyncDatabase } from '../db/database.js';
import { EmailVerificationService } from './emailVerification.js';
import { hashPassword } from './password.js';
import { serverLogger } from '../observability/ServerLogger.js';
import { sendSystemEmail } from '../email/emailService.js';

export class PasswordResetService {
  private verificationService: EmailVerificationService;

  constructor(private db: AsyncDatabase) {
    this.verificationService = new EmailVerificationService(db);
  }

  async requestPasswordReset(email: string): Promise<{ code: string; success: boolean; message?: string }> {
    const user = await this.db.queryOne<{ id: string; email?: string }>(
      `SELECT user_id AS id, email FROM auth_accounts WHERE email = ?`,
      [email.toLowerCase()]
    );

    if (!user) {
      // 为了安全，即使邮箱不存在也返回成功消息
      serverLogger.warn('auth/password-reset', `密码重置请求失败：邮箱不存在`, `email=${email}`);
      return {
        code: '',
        success: false,
        message: 'If this email exists, a reset code has been sent.',
      };
    }

    if (await this.verificationService.isInCooldown(email, 'password_reset', 1)) {
      return {
        code: '',
        success: false,
        message: 'Please wait before requesting another reset code.',
      };
    }

    const code = await this.verificationService.createVerificationCode(email, 'password_reset', 15);

    // 发送邮件
    const emailResult = await sendSystemEmail({
      to: email,
      subject: 'X-Computer 密码重置验证码',
      body: `您正在重置密码，验证码是：${code}，15 分钟内有效。\n\n如果不是您本人操作，请忽略此邮件。`,
      html: false,
    });

    if (!emailResult.ok) {
      serverLogger.warn('auth/password-reset', `密码重置邮件发送失败`, `email=${email} error=${emailResult.error}`);
      // 仍然返回成功，避免攻击者通过响应判断 SMTP 是否配置
      return {
        code: '',
        success: true,
        message: emailResult.error ?? 'Reset code sent.',
      };
    }

    serverLogger.info('auth/password-reset', `密码重置验证码已发送至邮箱`, `email=${email}`);
    return {
      code: process.env.NODE_ENV === 'development' ? code : '',
      success: true,
      message: 'Reset code sent successfully.',
    };
  }

  async resetPassword(email: string, code: string, newPassword: string): Promise<boolean> {
    const isValid = await this.verificationService.verifyCode(email, code, 'password_reset');

    if (!isValid) {
      serverLogger.warn('auth/password-reset', `密码重置失败：验证码无效`, `email=${email}`);
      return false;
    }

    const passwordHash = await hashPassword(newPassword);
    await this.db.run(
      `UPDATE auth_accounts SET password_hash = ? WHERE email = ?`,
      [passwordHash, email.toLowerCase()]
    );

    serverLogger.info('auth/password-reset', `密码重置成功`, `email=${email}`);
    return true;
  }
}
