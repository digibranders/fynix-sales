import path from 'node:path';

export interface Config {
  host: string;
  port: number;
  databaseUrl: string;
  production: boolean;
  sessionDays: number;
  appUrl: string;
  brevoApiKey: string | null;
  resendApiKey: string | null;
  mailFrom: string | null;
  webDir: string;
  /** BrandBasket coupon link: where its API lives, the key we send it, and the secret its webhooks are signed with. */
  bbApiUrl: string;
  integrationKey: string | null;
  webhookSecret: string | null;
}

const WEB_DIR = path.resolve(import.meta.dirname, '..', 'web');

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

export function loadConfig(): Config {
  return {
    host: process.env['HOST'] || '127.0.0.1',
    port: intFromEnv('PORT', 3000),
    databaseUrl: process.env['DATABASE_URL'] || 'postgres://localhost:5432/fynix_sales',
    production: process.env['NODE_ENV'] === 'production',
    sessionDays: intFromEnv('SESSION_DAYS', 14),
    appUrl: (process.env['APP_URL'] || `http://127.0.0.1:${intFromEnv('PORT', 3000)}`).replace(/\/+$/, ''),
    brevoApiKey: process.env['BREVO_API_KEY'] || null,
    resendApiKey: process.env['RESEND_API_KEY'] || null,
    mailFrom: process.env['MAIL_FROM'] || null,
    webDir: WEB_DIR,
    bbApiUrl: (process.env['BB_API_URL'] || 'http://console.brandbasket.localhost:3199').replace(/\/+$/, ''),
    integrationKey: process.env['FYNIX_INTEGRATION_KEY'] || null,
    webhookSecret: process.env['FYNIX_WEBHOOK_SECRET'] || null,
  };
}
