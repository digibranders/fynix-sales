import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';

export interface ParsedLead {
  externalId: string;
  name: string;
  googleCategory: string;
  area: string;
  city: string;
  address: string;
  phone: string;
  website: string;
  emails: string[];
  whatsapp: string;
  hours: string[];
  company: string;
  jobTitle: string;
  personalNumber: string;
  keywords: string;
  linkedinUrl: string;
  country: string;
  state: string;
}

export interface ParseResult {
  leads: ParsedLead[];
  skipped: number;
}

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const JUNK_EMAIL = ['.png', '.jpg', '.jpeg', '.webp', '.css', '.js', '.svg', '.gif', 'sentry', 'wixpress', 'example.', '@2x'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const MAX_IMPORT_ROWS = 20_000;

type Row = Record<string, string | undefined>;

function field(row: Row, ...names: string[]): string {
  for (const name of names) {
    const value = row[name];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  const rowKeys = Object.keys(row);
  for (const name of names) {
    const norm = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const key of rowKeys) {
      if (key.toLowerCase().replace(/[^a-z0-9]/g, '') === norm) {
        const value = row[key];
        if (typeof value === 'string' && value.trim() !== '') return value.trim();
      }
    }
  }
  return '';
}

function json(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function cleanEmails(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(',')) {
    const email = part.trim().toLowerCase();
    if (EMAIL.test(email) && !JUNK_EMAIL.some((junk) => email.includes(junk)) && !out.includes(email)) out.push(email);
  }
  return out.slice(0, 2);
}

export function cleanPhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
  if (digits.length === 11) digits = digits.replace(/^0+/, '');
  // Only Indian mobiles (6-9 first digit) group as 5+5; landlines have variable area codes, so keep them as given.
  return digits.length === 10 && /^[6-9]/.test(digits) ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` : raw.trim();
}

function cleanName(raw: string): string {
  const first = raw.split(' | ')[0] ?? raw;
  return (first.split(' – ')[0] ?? first).trim().slice(0, 80);
}

function lastPart(text: string): string {
  const parts = text.split(',');
  return (parts[parts.length - 1] ?? '').trim();
}

function whatsappFrom(orderOnline: unknown): string {
  if (!Array.isArray(orderOnline)) return '';
  for (const item of orderOnline) {
    const link = asRecord(item)['link'];
    if (typeof link === 'string' && link.includes('wa.me')) return link.replace(/\D/g, '');
  }
  return '';
}

function hoursFrom(openHours: unknown): string[] {
  const record = asRecord(openHours);
  return DAYS.map((day) => {
    const value = record[day];
    const first = Array.isArray(value) ? value[0] : '';
    return typeof first === 'string' ? first.replace(/\u202f/g, ' ') : '';
  });
}

function fallbackId(name: string, phone: string, address: string): string {
  return `h_${createHash('sha1').update(`${name}|${phone}|${address}`).digest('hex').slice(0, 16)}`;
}

/** Turns an exported Google Maps style CSV into clean lead records. Rows without a name are skipped. */
export function parseLeadsCsv(text: string): ParseResult {
  let rows: Row[];
  try {
    rows = parse(text, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      bom: true,
      trim: false,
    }) as Row[];
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unreadable file';
    throw new Error(`The file is not a valid CSV: ${reason}`, { cause: error });
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`The file has ${rows.length} rows. The limit is ${MAX_IMPORT_ROWS} per import.`);
  }
  const first = rows[0];
  if (!first) throw new Error('The file has no rows.');
  const firstKeys = Object.keys(first).map((k) => k.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const hasName = firstKeys.some((k) => k === 'title' || k === 'name' || k === 'fullname' || k === 'firstname');
  if (!hasName) throw new Error('The file needs a "title", "name", or "Full Name" column.');

  const seen = new Set<string>();
  const leads: ParsedLead[] = [];
  let skipped = 0;
  for (const row of rows) {
    const fullName = field(row, 'Full Name', 'full_name', 'FullName', 'name');
    const firstName = field(row, 'First Name', 'first_name', 'FirstName');
    const lastName = field(row, 'Last Name', 'last_name', 'LastName');
    const rawName = fullName || field(row, 'title', 'name') || [firstName, lastName].filter(Boolean).join(' ');
    const name = cleanName(rawName);
    if (!name) {
      skipped += 1;
      continue;
    }

    const company = field(row, 'Company', 'company_name', 'Company Name', 'company');
    const jobTitle = field(row, 'Job Title', 'job_title', 'JobTitle', 'title', 'designation');
    const personalNumberRaw = field(row, 'Personal Number', 'personal_number', 'Personal Phone', 'mobile');
    const personalNumber = personalNumberRaw ? cleanPhone(personalNumberRaw) : '';
    const phone = personalNumber || cleanPhone(field(row, 'phone', 'Phone', 'Phone Number', 'contact_number'));
    const keywords = field(row, 'Keywords', 'keywords', 'Keyword', 'keyword');
    const linkedinUrl = field(row, 'Linkedin Url', 'linkedin_url', 'LinkedIn Url', 'Linkedin', 'LinkedIn');
    const country = field(row, 'Country', 'country');
    const stateVal = field(row, 'State', 'state');
    const complete = asRecord(json(field(row, 'complete_address')));
    const borough = lastPart(String(complete['borough'] ?? ''));
    const parsedCity = lastPart(String(complete['city'] ?? '')) || field(row, 'city', 'City');
    const city = parsedCity || borough;
    const address = field(row, 'address', 'Address') || [city, stateVal, country].filter(Boolean).join(', ');
    const area = borough.length >= 3 && borough.toLowerCase() !== city.toLowerCase()
      ? borough
      : (field(row, 'area', 'Area') || [city, stateVal].filter(Boolean).join(', ') || city);
    const website = field(row, 'website', 'Company Website', 'Company Url', 'Website', 'company_website');
    const emailsRaw = field(row, 'emails', 'email', 'Email', 'Emails');
    const emails = cleanEmails(emailsRaw);
    const googleCategory = field(row, 'category', 'Industry', 'industry', 'Category');
    const externalId = field(row, 'place_id', 'id', 'input_id', 'Email', 'email', 'Linkedin Url') || fallbackId(name, phone || company, address || city);

    if (seen.has(externalId)) {
      skipped += 1;
      continue;
    }
    seen.add(externalId);

    leads.push({
      externalId,
      name,
      googleCategory,
      area: area || city,
      city,
      address,
      phone,
      website,
      emails,
      whatsapp: whatsappFrom(json(field(row, 'order_online'))),
      hours: hoursFrom(json(field(row, 'open_hours'))),
      company,
      jobTitle,
      personalNumber,
      keywords,
      linkedinUrl,
      country,
      state: stateVal,
    });
  }
  return { leads, skipped };
}
