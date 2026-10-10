import type { PageHit } from './source';

type Candidate = Omit<PageHit, 'score'>;

const STOPWORDS = new Set(
  (
    'a an and are about all any can does did for from give has have how into its not off one our out ' +
    'tell that the their them then there these this those was what when where which who why will with ' +
    'you your explain describe show use used using say says mean means me my is it of on or in to be ' +
    // Words about WHERE something is written or that two sources disagree, not about the topic.
    // "Why does my professor's formula differ from the book's?" is a question about the position
    // equation; counting these words as content would sink its score below the abstain threshold.
    'professor professors lecture lectures slide slides book books textbook notes formula formulas ' +
    'differ differs different difference disagree'
  ).split(' '),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length >= 3 && !STOPWORDS.has(t),
  );
}

/** Hits scoring below this are dropped, so an unrelated question abstains instead of guessing. */
export const MIN_SCORE = 0.34;

/**
 * Words match exactly, or when they share a stem: a common prefix of at least 5 letters that is at
 * least 80% of the shorter word. "accelerates" finds "acceleration" and "force" finds "forces",
 * but "quantum" does not find "quantity" (5 of 7 letters), which would be a false match.
 */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common += 1;
  return common >= 5 && common / Math.min(a.length, b.length) >= 0.8;
}

/**
 * Deterministic keyword ranking: score is the share of distinct query words found in the chunk.
 * Ties break on page, then id, so the same question always returns the same hits in the same order.
 */
export function rankHits(candidates: Candidate[], query: string, topK: number): PageHit[] {
  const words = [...new Set(tokenize(query))];
  if (words.length === 0) return [];
  const scored: PageHit[] = [];
  for (const c of candidates) {
    const haystack = tokenize(`${c.documentTitle} ${c.text}`);
    const matched = words.filter((w) => haystack.some((h) => sameWord(w, h)));
    const score = matched.length / words.length;
    if (score >= MIN_SCORE) scored.push({ ...c, score: Math.round(score * 100) / 100 });
  }
  scored.sort((a, b) => b.score - a.score || a.page - b.page || a.chunkId.localeCompare(b.chunkId));
  return scored.slice(0, topK);
}
