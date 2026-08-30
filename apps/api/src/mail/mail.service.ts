import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { getEnv } from '../config/env';

function webBase() {
  return getEnv().WEB_ORIGIN.split(',')[0]?.trim().replace(/\/$/, '') || 'http://localhost:5173';
}

function wrapHtml(title: string, body: string) {
  return `<!DOCTYPE html><html><body style="font-family:Segoe UI,Arial,sans-serif;color:#1b2430;line-height:1.5">
  <p style="font-weight:700;margin:0 0 12px">Las Vegas Designs</p>
  <p style="margin:0 0 16px">${title}</p>
  ${body}
  <p style="color:#6b7280;font-size:12px;margin-top:24px">If you did not expect this email, you can ignore it.</p>
  </body></html>`;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  private smtpHost() {
    return (process.env.SMTP_HOST ?? '').trim();
  }

  private smtpUser() {
    return (process.env.SMTP_USER ?? '').trim();
  }

  private smtpPassword() {
    return (process.env.SMTP_PASSWORD ?? process.env.SMTP_PASS ?? '').trim();
  }

  private fromAddress() {
    return (
      (process.env.SMTP_FROM_ADDRESS ?? process.env.SMTP_FROM ?? '').trim() ||
      this.smtpUser() ||
      'noreply@designs-crm.local'
    );
  }

  private getTransport(): Transporter | null {
    const host = this.smtpHost();
    if (!host) return null;
    if (this.transporter) return this.transporter;
    const user = this.smtpUser();
    const pass = this.smtpPassword();
    this.transporter = createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: user && pass ? { user, pass } : undefined,
    });
    return this.transporter;
  }

  isConfigured() {
    return Boolean(this.smtpHost());
  }

  async sendMail(opts: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<boolean> {
    const to = opts.to.trim();
    if (!to) return false;
    const transport = this.getTransport();
    if (!transport) {
      this.logger.warn(
        `SMTP not configured — skipped email to ${to}: ${opts.subject}`,
      );
      return false;
    }
    try {
      await transport.sendMail({
        from: this.fromAddress(),
        to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html ?? opts.text.replace(/\n/g, '<br/>'),
      });
      return true;
    } catch (err) {
      this.logger.error(`Failed to send mail to ${to}: ${String(err)}`);
      return false;
    }
  }

  async sendEmailVerification(to: string, token: string) {
    const link = `${webBase()}/login?verify=${encodeURIComponent(token)}`;
    return this.sendMail({
      to,
      subject: 'Verify your email — Las Vegas Designs',
      text: `Thanks for creating an account.\n\nConfirm this email address:\n${link}\n\nThe link expires in 48 hours. After you verify, our team reviews the login request before you can sign in.`,
      html: wrapHtml(
        'Confirm your email address',
        `<p>Thanks for creating an account. Click below to verify this address. The link expires in 48 hours.</p>
         <p><a href="${link}">Verify my email</a></p>
         <p>After you verify, our team reviews the login request before you can sign in.</p>`,
      ),
    });
  }

  async sendPasswordReset(to: string, token: string) {
    const link = `${webBase()}/login?reset=${encodeURIComponent(token)}`;
    return this.sendMail({
      to,
      subject: 'Reset your password — Las Vegas Designs',
      text: `We received a request to reset your password.\n\n${link}\n\nThis link expires in 1 hour. If you did not ask for this, ignore this email.`,
      html: wrapHtml(
        'Reset your password',
        `<p>We received a request to reset your password. This link expires in 1 hour.</p>
         <p><a href="${link}">Choose a new password</a></p>`,
      ),
    });
  }

  async sendEmailChangeConfirm(to: string, token: string) {
    const link = `${webBase()}/login?emailChange=${encodeURIComponent(token)}`;
    return this.sendMail({
      to,
      subject: 'Confirm your new email — Las Vegas Designs',
      text: `Confirm this new email address for your account:\n\n${link}\n\nThe link expires in 24 hours.`,
      html: wrapHtml(
        'Confirm your new email',
        `<p>You asked to change the email on your account. Confirm this address. The link expires in 24 hours.</p>
         <p><a href="${link}">Confirm new email</a></p>`,
      ),
    });
  }

  async sendAccountApproved(to: string) {
    const link = `${webBase()}/login`;
    return this.sendMail({
      to,
      subject: 'Your portal access is approved',
      text: `Your Las Vegas Designs account is approved. You can sign in now:\n\n${link}`,
      html: wrapHtml(
        'You can sign in now',
        `<p>Your account is approved. Welcome in.</p><p><a href="${link}">Sign in</a></p>`,
      ),
    });
  }

  async sendLoginRequestToAdmin(to: string, customerName: string, customerEmail: string) {
    const link = `${webBase()}/admin/login-requests`;
    return this.sendMail({
      to,
      subject: `New login request: ${customerName}`,
      text: `${customerName} (${customerEmail}) verified their email and is waiting for portal access.\n\n${link}`,
      html: wrapHtml(
        'New login request',
        `<p><strong>${customerName}</strong> (${customerEmail}) verified their email and is waiting for portal access.</p>
         <p><a href="${link}">Review login requests</a></p>`,
      ),
    });
  }

  async sendQuoteReady(to: string, orderName: string, orderId: string) {
    const link = `${webBase()}/portal/quotes/${orderId}`;
    return this.sendMail({
      to,
      subject: `Your quote is ready: ${orderName}`,
      text: `We priced ${orderName}. Open the quote to accept, decline, or send a counter:\n\n${link}`,
      html: wrapHtml(
        'Your quote is ready',
        `<p>We priced <strong>${orderName}</strong>. Open it to accept, decline, or send a counter.</p>
         <p><a href="${link}">Review quote</a></p>`,
      ),
    });
  }

  async sendFilesReady(
    to: string,
    orderName: string,
    orderId: string,
    fileNames: string[],
  ) {
    const link = `${webBase()}/portal/orders/${orderId}`;
    const list = fileNames.length
      ? `\n\nFiles:\n${fileNames.map((n) => `- ${n}`).join('\n')}`
      : '';
    return this.sendMail({
      to,
      subject: `Your files are ready: ${orderName}`,
      text: `Deliverables for ${orderName} are in your portal.\n\n${link}${list}`,
      html: wrapHtml(
        'Your files are ready',
        `<p>Deliverables for <strong>${orderName}</strong> are in your portal.</p>
         ${fileNames.length ? `<ul>${fileNames.map((n) => `<li>${n}</li>`).join('')}</ul>` : ''}
         <p><a href="${link}">Open order</a></p>`,
      ),
    });
  }

  async sendInvoiceReminder(
    to: string,
    coversText: string,
    amountLabel: string,
    payUrl: string,
  ) {
    const link = payUrl.startsWith('http') ? payUrl : `${webBase()}${payUrl}`;
    return this.sendMail({
      to,
      subject: `Invoice reminder: ${coversText}`,
      text: `This is a reminder that ${coversText} (${amountLabel}) is still awaiting payment.\n\nPay securely with a card here:\n${link}`,
      html: wrapHtml(
        'Payment reminder',
        `<p>This is a reminder that <strong>${coversText}</strong> (${amountLabel}) is still awaiting payment.</p>
         <p><a href="${link}">Pay this invoice</a></p>
         <p>You can pay by card on that page, or use store credit in the portal if you have a balance.</p>`,
      ),
    });
  }

  async sendFormatInvoice(
    to: string,
    format: string,
    orderRef: string,
    amountLabel: string,
    payUrl: string,
  ) {
    const link = payUrl.startsWith('http') ? payUrl : `${webBase()}${payUrl}`;
    return this.sendMail({
      to,
      subject: `Invoice for ${format} export: ${orderRef}`,
      text: `Your ${format} export for ${orderRef} is ready after payment (${amountLabel}).\n\nPay here:\n${link}`,
      html: wrapHtml(
        'Export invoice',
        `<p>Your <strong>${format}</strong> export for <strong>${orderRef}</strong> is ready after payment (${amountLabel}).</p>
         <p><a href="${link}">Pay this invoice</a></p>`,
      ),
    });
  }

  async sendFormatReady(
    to: string,
    format: string,
    orderRef: string,
  ) {
    const link = `${webBase()}/portal/files`;
    return this.sendMail({
      to,
      subject: `Your ${format} file is ready: ${orderRef}`,
      text: `Your ${format} export for ${orderRef} is in your Files library.\n\n${link}`,
      html: wrapHtml(
        'Your export is ready',
        `<p>Your <strong>${format}</strong> export for <strong>${orderRef}</strong> is in your Files library.</p>
         <p><a href="${link}">Open Files</a></p>`,
      ),
    });
  }

  async sendFormatRequestReceived(to: string, format: string, orderRef: string) {
    return this.sendMail({
      to,
      subject: `We received your ${format} export request`,
      text: `We received your request to export ${orderRef} as ${format}. We’ll add the file to your library when it’s ready.`,
      html: wrapHtml(
        'Export request received',
        `<p>We received your request to export <strong>${orderRef}</strong> as <strong>${format}</strong>. We’ll add the file to your library when it’s ready.</p>`,
      ),
    });
  }

  async sendFormatRequestToStaff(
    to: string,
    format: string,
    orderRef: string,
    orderId: string,
  ) {
    const link = `${webBase()}/admin/orders/${orderId}`;
    return this.sendMail({
      to,
      subject: `New format request: ${format} for ${orderRef}`,
      text: `A customer asked for a ${format} export of ${orderRef}.\n\n${link}`,
      html: wrapHtml(
        'New format request',
        `<p>A customer asked for a <strong>${format}</strong> export of <strong>${orderRef}</strong>.</p>
         <p><a href="${link}">Open order</a></p>`,
      ),
    });
  }
}
