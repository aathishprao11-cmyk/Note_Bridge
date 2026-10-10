import type { Citation } from '@gyan/core';
import type { PageHit } from './source';
import type { AnswerDraft, CitationProblem } from './types';

export const ABSTAIN_TEXT =
  "I couldn't find support for that in your course material, so I won't guess. Try rephrasing, or upload the relevant slides or chapter.";

export type NotReturnedPolicy = 'strip' | 'mark';

export interface ValidateOptions {
  /**
   * What to do with a citation that no tool returned (it was invented):
   * - "strip" (default): remove it from the list and its [n] marker from the text.
   * - "mark": keep it, flagged unverified.
   * A citation to a chunk that WAS returned but with the wrong page or a quote that is not in the
   * chunk is always kept and marked unverified, because the source is real and the reader can check.
   */
  notReturned?: NotReturnedPolicy;
}

/**
 * Result of validation. `content`, `citations`, `abstained`, `confidence` and
 * `unverifiedCalculation` are exactly the fields of the contract's `done` event; the rest is for
 * logs and tests and is not sent. Citation n (as in "[n]") is `citations[n - 1]`.
 */
export interface ValidatedAnswer {
  content: string;
  citations: Citation[];
  abstained: boolean;
  /** Computed from retrieval scores and validation; null when abstained. */
  confidence: number | null;
  /** Always false until the Verifier is wired in: no number is checked by running code yet. */
  unverifiedCalculation: boolean;
  /** Per citation, why it is unverified (null when verified). Parallel to `citations`. */
  problems: Array<CitationProblem | null>;
  unverifiedCount: number;
  /** Citations (or dangling markers) removed because no tool returned them. */
  strippedCount: number;
}

const MARKER = /(\s*)\[(\d+)\]/g;

/** Collapse whitespace and unify quotes/dashes so a quote still matches across line breaks. */
export function normalizeForQuote(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function quoteAppearsIn(quote: string, chunkText: string): boolean {
  const q = normalizeForQuote(quote);
  return q.length > 0 && normalizeForQuote(chunkText).includes(q);
}

function problemFor(
  c: AnswerDraft['citations'][number],
  hit: PageHit | undefined,
): CitationProblem | null {
  if (!hit || hit.documentId !== c.documentId) return 'not_returned';
  if (hit.page !== c.page || hit.printedPage !== c.printedPage) return 'page_mismatch';
  if (!quoteAppearsIn(c.quote, hit.text)) return 'quote_mismatch';
  return null;
}

/**
 * The answer-validate step. Every citation is checked against what the tools actually returned.
 * Citations to chunks no tool returned are stripped (or marked); wrong pages and quotes that are
 * not in the chunk are marked unverified. An answer left with no verified citation is replaced by
 * an abstention, so the UI never presents an unsupported answer as grounded.
 */
export function validateAnswer(
  draft: AnswerDraft,
  returned: PageHit[],
  options: ValidateOptions = {},
): ValidatedAnswer {
  const policy = options.notReturned ?? 'strip';
  const byId = new Map(returned.map((h) => [h.chunkId, h]));

  // Decide each citation's fate, keyed by its original 1-based position in the draft.
  const kept = new Map<
    number,
    { cite: AnswerDraft['citations'][number]; problem: CitationProblem | null }
  >();
  let stripped = 0;
  draft.citations.forEach((cite, i) => {
    const problem = problemFor(cite, byId.get(cite.chunkId));
    if (problem === 'not_returned' && policy === 'strip') {
      stripped += 1;
      return;
    }
    kept.set(i + 1, { cite, problem });
  });

  // Renumber the survivors 1..k in the order they first appear in the text, then any unreferenced.
  const order: number[] = [];
  for (const m of draft.text.matchAll(MARKER)) {
    const n = Number(m[2]);
    if (kept.has(n) && !order.includes(n)) order.push(n);
  }
  for (const n of kept.keys()) if (!order.includes(n)) order.push(n);
  const newNumber = new Map(order.map((n, i) => [n, i + 1]));

  let strippedMarkers = 0;
  const text = draft.text.replace(MARKER, (_m, space: string, digits: string) => {
    const n = Number(digits);
    const next = newNumber.get(n);
    if (next === undefined) {
      strippedMarkers += 1;
      return '';
    }
    return `${space}[${next}]`;
  });

  const problems = order.map((n) => kept.get(n)!.problem);
  const citations: Citation[] = order.map((n, i) => {
    const { cite } = kept.get(n)!;
    return {
      documentId: cite.documentId,
      chunkId: cite.chunkId,
      page: cite.page,
      printedPage: cite.printedPage,
      quote: cite.quote,
      status: problems[i] === null ? 'verified' : 'unverified',
    };
  });

  const verified = citations.filter((c) => c.status === 'verified');
  const unverifiedCount = citations.length - verified.length;
  const strippedCount = stripped + (stripped === 0 ? strippedMarkers : 0);

  if (draft.abstained || verified.length === 0) {
    return {
      content: draft.abstained ? draft.text.trim() || ABSTAIN_TEXT : ABSTAIN_TEXT,
      // An abstention carries no citations. Anything the model attached is dropped, not displayed.
      citations: [],
      confidence: null,
      abstained: true,
      unverifiedCalculation: false,
      problems: [],
      unverifiedCount: 0,
      strippedCount: draft.abstained ? 0 : strippedCount + unverifiedCount,
    };
  }

  // Confidence is computed from retrieval scores and validation, never taken from a model.
  const scores = verified.map((c) => byId.get(c.chunkId)?.score ?? 0);
  const meanScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const share = verified.length / citations.length;
  return {
    content: text.trim(),
    citations,
    confidence: Math.round(meanScore * share * 100) / 100,
    abstained: false,
    unverifiedCalculation: false,
    problems,
    unverifiedCount,
    strippedCount,
  };
}
