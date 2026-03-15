/**
 * 密码重置服务
 */

import type { AsyncDatabase } from '../db/database.js';
import { EmailVerificationService } from './emailVerification.js';
import { hashPassword } from './password.js';
import { serverLogger } from '../observability/ServerLogger.js';

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
    serverLogger.info('auth/password-reset', `密码重置验证码已生成`, `email=${email}`);
    return {
      code,
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
