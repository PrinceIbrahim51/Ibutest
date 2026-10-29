// ASCII control characters except TAB (\u0009), LF (\u000A) and CR (\u000D).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
// Unicode bidirectional override/isolate characters ("Trojan Source" style spoofing).
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g;

/**
 * Normalises user supplied free text before it is validated and stored.
 * All text is stored and rendered as plain text (never as HTML), so this is about
 * removing invisible/control characters rather than escaping markup.
 */
export function cleanText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(BIDI_CONTROLS, '');
}

/** Escapes LIKE/ILIKE wildcards so user search input is matched literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Serialises one CSV cell. Values starting with a spreadsheet formula trigger are
 * prefixed with a quote to prevent CSV/formula injection when opened in Excel etc.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_PREFIX.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
