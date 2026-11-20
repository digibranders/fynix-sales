import type { Config } from './config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  readonly enabled: boolean;
  /** Resolves true when the message was accepted by the mail provider. Never throws. */
  send(message: MailMessage): Promise<boolean>;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** Splits `Name <address>` (or a bare address) into the two parts Brevo wants. Returns null when there is no usable address. */
export function parseSender(from: string): { name?: string; email: string } | null {
  const match = /^\s*(?:"?([^"<]*?)"?\s*)?<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from);
  if (match?.[2]) {
    const name = match[1]?.trim();
    return name ? { name, email: match[2] } : { email: match[2] };
  }
  const bare = from.trim();
  return /^[^\s<>@]+@[^\s<>@]+$/.test(bare) ? { email: bare } : null;
}

class BrevoMailer implements Mailer {
  readonly enabled = true;

  constructor(
    private readonly apiKey: string,
    private readonly sender: { name?: string; email: string },
  ) {}

  async send(message: MailMessage): Promise<boolean> {
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': this.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          sender: this.sender,
          to: [{ email: message.to }],
          subject: message.subject,
          textContent: message.text,
          htmlContent: message.html,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        console.error(`Brevo rejected an email (${response.status}): ${(await response.text()).slice(0, 300)}`);
        return false;
      }
      return true;
    } catch (error) {
      console.error('Could not reach Brevo:', error instanceof Error ? error.message : error);
      return false;
    }
  }
}

class ResendMailer implements Mailer {
  readonly enabled = true;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: MailMessage): Promise<boolean> {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        console.error(`Resend rejected an email (${response.status}): ${(await response.text()).slice(0, 300)}`);
        return false;
      }
      return true;
    } catch (error) {
      console.error('Could not reach Resend:', error instanceof Error ? error.message : error);
      return false;
    }
  }
}

class DisabledMailer implements Mailer {
  readonly enabled = false;

  async send(): Promise<boolean> {
    return false;
  }
}

export function createMailer(config: Config): Mailer {
  if (config.brevoApiKey && config.mailFrom) {
    const sender = parseSender(config.mailFrom);
    if (sender) return new BrevoMailer(config.brevoApiKey, sender);
    console.error('MAIL_FROM must look like "Name <address@your-domain>". Email is switched off.');
    return new DisabledMailer();
  }
  if (config.resendApiKey && config.mailFrom) return new ResendMailer(config.resendApiKey, config.mailFrom);
  return new DisabledMailer();
}

export function inviteEmail(opts: { name: string; email: string; invitedBy: string; link: string; reset: boolean; days: number }): MailMessage {
  const { name, email, invitedBy, link, reset, days } = opts;
  const subject = reset ? 'Choose a new Fynix Sales password' : `${invitedBy} invited you to Fynix Sales`;
  const intro = reset ? `${invitedBy} sent you a link to choose a new Fynix Sales password.` : `${invitedBy} added you to Fynix Sales.`;
  const cta = reset ? 'Choose a new password' : 'Set your password and get started';
  const note = `This link works once and expires in ${days} days. It is only for ${email}.`;
  const text = [`Hi ${name},`, '', intro, '', `${cta}:`, link, '', note].join('\n');
  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111318">
<p>Hi ${escapeHtml(name)},</p>
<p>${escapeHtml(intro)}</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#0d1f16;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600">${escapeHtml(cta)}</a></p>
<p style="color:#6a7280">${escapeHtml(note)}</p></div>`;
  return { to: email, subject, text, html };
}
