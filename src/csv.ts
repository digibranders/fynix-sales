/**
 * One CSV cell. Quotes values that need it, and neutralises text that a spreadsheet would run as a
 * formula (a leading =, +, - or @) by prefixing an apostrophe.
 */
export function csvCell(value: string | number): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvRow(values: (string | number)[]): string {
  return values.map(csvCell).join(',');
}
