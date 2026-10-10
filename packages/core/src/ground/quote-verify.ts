/**
 * Quote verification (BRIEF 2 and 9.2): every quote the model produces is checked in code against
 * the text of the chunk it cites. Fuzzy, so OCR noise and whitespace do not cause false failures,
 * but a quote the source does not contain scores low.
 */

/** Longest quotable snippet (BRIEF 2: never redistribute book text beyond short snippets). */
export const MAX_QUOTE_WORDS = 20;

const normalise = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((cur[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

export function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/**
 * Best similarity (0..1) between `quote` and any stretch of `source`. 1 means the quote appears
 * verbatim (ignoring case and whitespace). Slides a word window over the source and keeps the best
 * normalised edit-distance match.
 */
export function quoteMatchScore(source: string, quote: string): number {
  const q = normalise(quote);
  const s = normalise(source);
  if (q.length === 0) return 0;
  if (s.includes(q)) return 1;

  const words = s.split(' ');
  const qWords = q.split(' ').length;
  let best = 0;
  for (let size = Math.max(1, qWords - 1); size <= qWords + 1; size++) {
    for (let i = 0; i + size <= words.length; i++) {
      const window = words.slice(i, i + size).join(' ');
      const score = 1 - levenshtein(window, q) / Math.max(window.length, q.length);
      if (score > best) best = score;
    }
  }
  return Math.max(0, best);
}

/** True when the quote is short enough to show and matches its source at least `min` well. */
export function verifyQuoteText(source: string, quote: string, min: number): boolean {
  return wordCount(quote) <= MAX_QUOTE_WORDS && quoteMatchScore(source, quote) >= min;
}
