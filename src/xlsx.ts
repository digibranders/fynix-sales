import { inflateRawSync } from 'node:zlib';

/**
 * Reads the first sheet of an .xlsx workbook and returns it as CSV text, so the same importer handles both file types.
 * An .xlsx file is a zip of XML parts; this reads just the parts needed (workbook, shared strings and the first sheet).
 */

const MAX_PART = 60 * 1024 * 1024;

interface Entry {
  method: number;
  compressedSize: number;
  localOffset: number;
}

function readZip(buf: Buffer): Map<string, Entry> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('That does not look like an .xlsx file.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Entry>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The .xlsx file is damaged.');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    out.set(buf.toString('utf8', p + 46, p + 46 + nameLen), { method, compressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function part(buf: Buffer, zip: Map<string, Entry>, name: string): string | null {
  const e = zip.get(name);
  if (!e) return null;
  const p = e.localOffset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) throw new Error('The .xlsx file is damaged.');
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const raw = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return raw.toString('utf8');
  if (e.method !== 8) throw new Error('That .xlsx file uses a compression this importer cannot read.');
  try {
    return inflateRawSync(raw, { maxOutputLength: MAX_PART }).toString('utf8');
  } catch {
    throw new Error('The .xlsx file is damaged or too large.');
  }
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** The text inside the <t> parts of a shared or inline string, leaving out phonetic hints. */
function textOf(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of clean.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += m[1] ?? '';
  return unescapeXml(out);
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/[^A-Za-z]/g, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Plain CSV quoting. Unlike the export helper, values are kept exactly as typed (a phone number may start with +). */
function csvLine(values: string[]): string {
  return values.map((v) => (/[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)).join(',');
}

export function xlsxToCsv(buf: Buffer): string {
  const zip = readZip(buf);
  const workbook = part(buf, zip, 'xl/workbook.xml');
  if (!workbook) throw new Error('That does not look like an .xlsx file.');

  // Find the first sheet through the workbook's relationships, falling back to sheet1.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const first = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook);
  const rels = part(buf, zip, 'xl/_rels/workbook.xml.rels');
  if (first && rels) {
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const tag = m[0];
      if (new RegExp(`\\bId="${first[1]}"`).test(tag)) {
        const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
        if (target) sheetPath = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      }
    }
  }
  const sheet = part(buf, zip, sheetPath);
  if (!sheet) throw new Error('The first sheet in that .xlsx file could not be found.');

  const sharedXml = part(buf, zip, 'xl/sharedStrings.xml');
  const shared: string[] = [];
  if (sharedXml) for (const m of sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1] ?? ''));

  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cm of (rm[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1] ?? '';
      const inner = cm[2] ?? '';
      const ref = /\br="([A-Za-z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = textOf(inner);
      else if (v !== undefined) value = type === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : unescapeXml(v);
      const at = ref ? columnIndex(ref) : cells.length;
      while (cells.length < at) cells.push('');
      cells[at] = value;
    }
    rows.push(cells);
  }
  while (rows.length && rows[rows.length - 1]!.every((c) => c === '')) rows.pop();
  if (rows.length === 0) throw new Error('That .xlsx file has no rows.');
  return rows.map((r) => csvLine(r)).join('\n');
}
