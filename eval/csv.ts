import type { KeyRow } from './score';

/** Minimal CSV: comma separated, optional double quotes, no embedded newlines. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** eval/labeled.csv: unit_text_or_id, correct_book, correct_page_start, correct_page_end. */
export function parseLabeled(text: string): KeyRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const header = parseCsvLine(lines[0] ?? '');
  const want = ['unit_text_or_id', 'correct_book', 'correct_page_start', 'correct_page_end'];
  if (want.some((w, i) => header[i] !== w)) {
    throw new Error(`labeled.csv header must be: ${want.join(',')}`);
  }
  return lines.slice(1).map((line, n) => {
    const [unit = '', book = '', a = '', b = ''] = parseCsvLine(line);
    const num = (s: string): number | null => {
      if (s === '') return null;
      const v = Number(s);
      if (!Number.isInteger(v)) throw new Error(`labeled.csv row ${n + 2}: "${s}" is not a page`);
      return v;
    };
    const pageStart = num(a);
    const pageEnd = num(b);
    if (unit === '') throw new Error(`labeled.csv row ${n + 2}: missing unit`);
    if ((book === '') !== (pageStart === null) || (pageStart === null) !== (pageEnd === null)) {
      throw new Error(`labeled.csv row ${n + 2}: book and both pages are all set or all empty`);
    }
    if (pageStart !== null && pageEnd !== null && pageEnd < pageStart) {
      throw new Error(`labeled.csv row ${n + 2}: page end is before page start`);
    }
    return { unit, book, pageStart, pageEnd };
  });
}
