import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { getEnv } from '../config/env';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  private getTransport(): Transporter | null {
    const env = getEnv() as ReturnType<typeof getEnv> & {
      SMTP_HOST?: string;
      SMTP_PORT?: number;
      SMTP_USER?: string;
      SMTP_PASS?: string;
      SMTP_FROM?: string;
    };
    const host = process.env.SMTP_HOST?.trim();
    if (!host) return null;
    if (this.transporter) return this.transporter;
    this.transporter = createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS,
            }
          : undefined,
    });
    return this.transporter;
  }

  private fromAddress() {
    return (
      process.env.SMTP_FROM?.trim() ||
      process.env.SMTP_USER?.trim() ||
      'noreply@designs-crm.local'
    );
  }

  async sendMail(opts: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<boolean> {
    const transport = this.getTransport();
    if (!transport) {
      this.logger.warn(
        `SMTP not configured — skipped email to ${opts.to}: ${opts.subject}`,
      );
      return false;
    }
    try {
      await transport.sendMail({
        from: this.fromAddress(),
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html ?? opts.text.replace(/\n/g, '<br/>'),
      });
      return true;
    } catch (err) {
      this.logger.error(`Failed to send mail to ${opts.to}: ${String(err)}`);
      return false;
    }
  }

  async sendPasswordReset(to: string, token: string) {
    const base = getEnv().WEB_ORIGIN.replace(/\/$/, '');
    const link = `${base}/login?reset=${encodeURIComponent(token)}`;
    return this.sendMail({
      to,
      subject: 'Reset your Designs CRM password',
      text: `Reset your password using this link (expires in 1 hour):\n\n${link}\n\nIf you did not request this, ignore this email.`,
      html: `<p>Reset your password using this link (expires in 1 hour):</p><p><a href="${link}">${link}</a></p><p>If you did not request this, ignore this email.</p>`,
    });
  }

  async sendEmailVerification(to: string, token: string) {
    const base = getEnv().WEB_ORIGIN.replace(/\/$/, '');
    const link = `${base}/login?verify=${encodeURIComponent(token)}`;
    return this.sendMail({
      to,
      subject: 'Verify your Designs CRM email',
      text: `Verify your email to finish creating your account:\n\n${link}\n\nAfter verification, an admin will review your login request.`,
      html: `<p>Verify your email to finish creating your account:</p><p><a href="${link}">${link}</a></p><p>After verification, an admin will review your login request.</p>`,
    });
  }
}
