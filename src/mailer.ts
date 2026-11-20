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

  const origin = ((): string => {
    try {
      return new URL(link).origin;
    } catch {
      return '';
    }
  })();
  const logoUrl = origin ? `${origin}/assets/img/fynix-logo.png` : 'https://fynix.digital/assets/img/fynix-logo.png';
  const copyIconUrl = origin ? `${origin}/assets/img/copy-icon.png` : 'https://fynix.digital/assets/img/copy-icon.png';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(subject)}</title>
<style>
  body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  @media (prefers-color-scheme: dark) {
    .email-bg { background-color: #0b0f17 !important; }
    .email-card { background-color: #121824 !important; border-color: #1f2a3e !important; }
    .email-divider { border-bottom-color: #1c2638 !important; }
    .email-greeting { color: #f8fafc !important; }
    .email-text { color: #cbd5e1 !important; }
    .email-btn { background-color: #e9edf4 !important; color: #10151d !important; }
    .email-note { border-top-color: #1c2638 !important; color: #94a3b8 !important; }
    .email-strong { color: #e2e8f0 !important; }
    .email-fallback-label { color: #64748b !important; }
    .email-fallback-box { background-color: #0d121c !important; border-color: #1e283b !important; }
    .email-fallback-link { color: #94a3b8 !important; }
    .email-copy-btn { background-color: #172030 !important; border-color: #233147 !important; }
    .email-footer { color: #64748b !important; }
  }
</style>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" class="email-bg" style="background-color: #f8fafc; padding: 40px 16px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table border="0" cellpadding="0" cellspacing="0" width="100%" class="email-card" style="max-width: 520px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; box-shadow: 0 4px 14px rgba(15, 23, 42, 0.04); overflow: hidden;">
          <tr>
            <td style="padding: 36px 32px;">
              <!-- Header: Only real Fynix logo -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" class="email-divider" style="border-bottom: 1px solid #f1f5f9; padding-bottom: 20px; margin-bottom: 24px;">
                <tr>
                  <td align="left">
                    <img src="${escapeHtml(logoUrl)}" alt="Fynix" width="89" height="37" style="display: block; border: 0; outline: none; text-decoration: none; height: 32px; width: auto;" />
                  </td>
                </tr>
              </table>

              <!-- Greeting & Copy -->
              <p class="email-greeting" style="margin: 0 0 12px 0; font-size: 16px; font-weight: 700; color: #0f172a;">Hi ${escapeHtml(name)},</p>
              <p class="email-text" style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #334155;">${escapeHtml(intro)}</p>

              <!-- CTA Button styled like .btn.assign -->
              <table border="0" cellpadding="0" cellspacing="0" style="margin: 20px 0 24px 0;">
                <tr>
                  <td align="center" style="border-radius: 9px; background: #111318;">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(link)}" style="height:44px;v-text-anchor:middle;width:240px;" arcsize="20%" stroke="f" fillcolor="#111318">
                    <w:anchorlock/>
                    <center style="color:#ffffff;font-family:sans-serif;font-size:14px;font-weight:500;">${escapeHtml(cta)}</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-->
                    <a href="${escapeHtml(link)}" class="email-btn" target="_blank" style="display: inline-block; padding: 13px 22px; font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 500; line-height: 1; color: #ffffff; text-decoration: none; border-radius: 9px; background-color: #111318; box-shadow: 0 3px 6px rgba(0,0,0,0.2), 0 0 0 1px #111318, inset 0 0 6px 2px rgba(255,255,255,0.24);">${escapeHtml(cta)}</a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>

              <!-- Expiration Note -->
              <div class="email-note" style="border-top: 1px solid #f1f5f9; padding-top: 18px; font-size: 13px; line-height: 1.5; color: #64748b;">
                This link works once and expires in <strong class="email-strong" style="color: #0f172a;">${days} days</strong>. It is only for <strong class="email-strong" style="color: #0f172a;">${escapeHtml(email)}</strong>.
              </div>

              <!-- Fallback Link with Copy Icon on Right -->
              <div style="margin-top: 16px;">
                <p class="email-fallback-label" style="margin: 0 0 6px 0; font-size: 11.5px; color: #94a3b8; line-height: 1.5;">
                  If the button doesn't work, copy and paste this link into your browser:
                </p>
                <table border="0" cellpadding="0" cellspacing="0" width="100%" class="email-fallback-box" style="background-color: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px;">
                  <tr>
                    <td style="padding: 6px 8px 6px 12px; font-family: 'JetBrains Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; color: #475569; word-break: break-all; line-height: 1.4;">
                      <a href="${escapeHtml(link)}" class="email-fallback-link" style="color: #475569; text-decoration: none;">${escapeHtml(link)}</a>
                    </td>
                    <td width="36" align="center" style="padding: 4px 6px 4px 0;">
                      <a href="${escapeHtml(link)}" class="email-copy-btn" title="Copy link" style="display: inline-block; width: 28px; height: 28px; line-height: 28px; text-align: center; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; text-decoration: none;">
                        <img src="${escapeHtml(copyIconUrl)}" alt="Copy" width="14" height="14" style="display: inline-block; vertical-align: middle; border: 0;" />
                      </a>
                    </td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>
        </table>

        <!-- Footer -->
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; margin-top: 24px;">
          <tr>
            <td align="center" class="email-footer" style="font-size: 12px; color: #94a3b8; line-height: 1.5;">
              &copy; 2026 Fynix Digital
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { to: email, subject, text, html };
}
