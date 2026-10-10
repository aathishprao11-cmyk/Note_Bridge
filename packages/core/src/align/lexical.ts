/**
 * Deterministic lexical alignment (TF-IDF cosine). This is the offline, no-model matcher behind
 * "Run alignment" until the LLM judge exists. It finds WHICH book passages a lecture unit is about;
 * it cannot judge HOW they relate (extends / conflicts), so callers label its edges lexical_only
 * and cap their confidence. Pure: same input, same output.
 */

const STOP = new Set(
  'the and for are was were with that this from have has had not but you your can will would should could into onto over under than then them they their there here what when where which while who whom why how also each such only some any all more most other its our out use used using one two per via about above below between both because been being does did doing done'.split(
    ' ',
  ),
);

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w));
}

export interface Passage {
  id: string;
  text: string;
  /** Book > Chapter > Section header: searchable but never quoted. */
  header: string;
}

export interface Query {
  id: string;
  text: string;
}

export interface LexicalMatch {
  passageId: string;
  /** Cosine similarity 0..1. */
  score: number;
  /** A verbatim stretch of the unit text (max 20 words) that best overlaps the passage. */
  unitQuote: string;
  /** A verbatim stretch of the passage (max 20 words) that best overlaps the unit. */
  bookQuote: string;
}

export interface LexicalOptions {
  topK: number;
  /** Matches scoring below this are dropped: a unit with none is professor_only. */
  minScore: number;
}

export const DEFAULT_LEXICAL: LexicalOptions = { topK: 3, minScore: 0.12 };
const MAX_QUOTE_WORDS = 20;

type Vec = Map<string, number>;

function vectorOf(words: string[], idf: Map<string, number>): Vec {
  const tf = new Map<string, number>();
  for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);
  const v: Vec = new Map();
  for (const [w, n] of tf) v.set(w, (1 + Math.log(n)) * (idf.get(w) ?? 0));
  return v;
}

function cosine(a: Vec, b: Vec): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const x of a.values()) na += x * x;
  for (const x of b.values()) nb += x * x;
  for (const [w, x] of a) dot += x * (b.get(w) ?? 0);
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** The sentence of `text` sharing the most vocabulary with `other`, cut to 20 words. */
export function bestSentence(text: string, other: string): string {
  const otherWords = new Set(tokens(other));
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  let best = '';
  let bestScore = -1;
  for (const s of sentences) {
    const words = tokens(s);
    const shared = words.filter((w) => otherWords.has(w)).length;
    const score = shared / Math.sqrt(Math.max(1, words.length));
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best.split(/\s+/).slice(0, MAX_QUOTE_WORDS).join(' ');
}

export function alignLexical(
  queries: Query[],
  passages: Passage[],
  options: LexicalOptions = DEFAULT_LEXICAL,
): Map<string, LexicalMatch[]> {
  const docs = passages.map((p) => tokens(`${p.header} ${p.text}`));
  const df = new Map<string, number>();
  for (const words of docs) for (const w of new Set(words)) df.set(w, (df.get(w) ?? 0) + 1);
  const n = Math.max(1, passages.length);
  const idf = new Map([...df].map(([w, d]) => [w, Math.log(1 + n / d)]));
  const passageVecs = docs.map((words) => vectorOf(words, idf));

  const out = new Map<string, LexicalMatch[]>();
  for (const q of queries) {
    const qv = vectorOf(tokens(q.text), idf);
    const scored = passages
      .map((p, i) => ({ p, score: cosine(qv, passageVecs[i] ?? new Map()) }))
      .filter((x) => x.score >= options.minScore)
      // Deterministic: score desc, then id asc.
      .sort((a, b) => b.score - a.score || a.p.id.localeCompare(b.p.id))
      .slice(0, options.topK);
    out.set(
      q.id,
      scored.map(({ p, score }) => ({
        passageId: p.id,
        score,
        unitQuote: bestSentence(q.text, p.text),
        bookQuote: bestSentence(p.text, q.text),
      })),
    );
  }
  return out;
}
