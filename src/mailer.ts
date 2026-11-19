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
  if (config.resendApiKey && config.mailFrom) return new ResendMailer(config.resendApiKey, config.mailFrom);
  return new DisabledMailer();
}

export function inviteEmail(opts: { name: string; email: string; invitedBy: string; password: string; appUrl: string; reset: boolean }): MailMessage {
  const { name, email, invitedBy, password, appUrl, reset } = opts;
  const subject = reset ? 'Your Fynix Sales password was reset' : `${invitedBy} invited you to Fynix Sales`;
  const intro = reset ? `${invitedBy} reset your Fynix Sales password.` : `${invitedBy} added you to Fynix Sales.`;
  const text = [
    `Hi ${name},`,
    '',
    intro,
    '',
    `Sign in: ${appUrl}/login`,
    `Email: ${email}`,
    `Temporary password: ${password}`,
    '',
    'You will be asked to choose your own password the first time you sign in.',
  ].join('\n');
  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111318">
<p>Hi ${escapeHtml(name)},</p>
<p>${escapeHtml(intro)}</p>
<p><a href="${escapeHtml(appUrl)}/login">Sign in to Fynix Sales</a></p>
<p>Email: <b>${escapeHtml(email)}</b><br>Temporary password: <b style="font-family:monospace">${escapeHtml(password)}</b></p>
<p style="color:#6a7280">You will be asked to choose your own password the first time you sign in.</p></div>`;
  return { to: email, subject, text, html };
}
