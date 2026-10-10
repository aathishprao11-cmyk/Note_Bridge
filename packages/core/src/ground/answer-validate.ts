import type { Chunk, Citation } from '../types';
import { verifyQuoteText } from './quote-verify';

/**
 * Answer validation (BRIEF 9.2). Every chat answer passes through this before it is stored or shown:
 *  - a citation must point at a chunk that a tool call returned THIS turn, else it is unverified;
 *  - its quote must fuzzy-match that chunk (>= quoteMatchMin) and be at most 20 words;
 *  - page numbers come from the chunk in the database, never from the model;
 *  - every [Doc, p.N] in the text must match a retrieved chunk, else it is marked in place;
 *  - a number that no retrieved passage, question or verification result supports is flagged as
 *    an unverified calculation (numbers come from code: run_verification).
 * Nothing is silently dropped or silently kept: failures are marked so the UI can show them.
 */

export const UNVERIFIED_CITATION_MARK = '(unverified citation)';

export interface ValidateInput {
  text: string;
  citations: Citation[];
  /** Chunks returned by tool calls this turn: the only things the answer may cite. */
  retrieved: Chunk[];
  /** documentId -> title, to check [Doc, p.N] references in the text. */
  docTitles?: Record<string, string>;
  quoteMatchMin: number;
  /** True if run_verification ran this turn (its numbers are code-computed). */
  ranVerification: boolean;
  /** Extra text whose numbers are allowed: the user's question and the tool inputs. */
  knownText?: string;
}

export interface ValidateResult {
  text: string;
  citations: Citation[];
  unverifiedCalculation: boolean;
  /** Human-readable reasons, for logs and tests. */
  issues: string[];
}

const REF = /\[([^[\],]+),\s*p\.?\s*(\d+)(?:\s*[-\u2013]\s*(\d+))?\]/g;
const NUMBER = /\d+(?:\.\d+)?/g;

function numbersIn(s: string): Set<string> {
  return new Set(s.match(NUMBER) ?? []);
}

/** Mark every [Doc, p.N] in `text` for which `ok` is false. Pure; used per streamed delta too. */
export function markUnverifiedRefs(
  text: string,
  ok: (doc: string, from: number, to: number) => boolean,
): string {
  return text.replace(REF, (whole, doc: string, a: string, b: string | undefined) => {
    const from = Number(a);
    const to = b === undefined ? from : Number(b);
    return ok(doc.trim(), from, to) ? whole : `${whole} ${UNVERIFIED_CITATION_MARK}`;
  });
}

/**
 * Does "[Doc, p.N]" point at a page a tool really returned? The document name may be a short form
 * of the stored title ("University Physics" for "University Physics (synthetic sample)"). Pages
 * are PRINTED pages, because that is what the student sees and what answers cite.
 */
export function refChecker(
  retrieved: Chunk[],
  docTitles: Record<string, string>,
): (doc: string, from: number, to: number) => boolean {
  return (doc, from, to) =>
    retrieved.some((c) => {
      const title = docTitles[c.documentId]?.toLowerCase();
      const name = doc.toLowerCase();
      if (title === undefined || !(title.includes(name) || name.includes(title))) return false;
      const start = c.printedPageStart ?? c.pdfPageStart;
      const end = c.printedPageEnd ?? c.pdfPageEnd;
      return from <= end && to >= start;
    });
}

export function validateAnswerText(input: ValidateInput): ValidateResult {
  const issues: string[] = [];
  const byId = new Map(input.retrieved.map((c) => [c.id, c]));

  const citations = input.citations.map((c): Citation => {
    const chunk = byId.get(c.chunkId);
    if (!chunk) {
      issues.push(`citation ${c.chunkId}: not returned by any tool call this turn`);
      return { ...c, status: 'unverified' };
    }
    // Page numbers and document come from the stored chunk, whatever the model claimed.
    const resolved: Citation = {
      ...c,
      documentId: chunk.documentId,
      page: chunk.pdfPageStart,
      printedPage: chunk.printedPageStart,
    };
    if (!verifyQuoteText(chunk.text, c.quote, input.quoteMatchMin)) {
      issues.push(`citation ${c.chunkId}: quote does not match the chunk text`);
      return { ...resolved, status: 'unverified' };
    }
    return { ...resolved, status: 'verified' };
  });

  const refOk = refChecker(input.retrieved, input.docTitles ?? {});
  const text = input.docTitles ? markUnverifiedRefs(input.text, refOk) : input.text;
  if (text !== input.text) issues.push('text cites a page no tool call returned');

  // Numbers outside citation markers must be supported, unless run_verification produced them.
  const supported = numbersIn(
    [...input.retrieved.map((c) => c.text), input.knownText ?? ''].join(' '),
  );
  const unsupported = [...numbersIn(input.text.replace(REF, ' '))].filter((n) => !supported.has(n));
  const unverifiedCalculation = !input.ranVerification && unsupported.length > 0;
  if (unverifiedCalculation) issues.push(`unsupported numbers: ${unsupported.join(', ')}`);

  return { text, citations, unverifiedCalculation, issues };
}

/**
 * Confidence for a chat answer, computed from validation results (never the model's own number).
 * Starting rule, to be tuned with the eval: up to 0.8 by the share of verified citations; hard
 * caps mirror BRIEF 9.3 (an unverified quote caps at 0.4; an unverified calculation at 0.5).
 */
export function chatConfidence(args: {
  citations: Citation[];
  abstained: boolean;
  unverifiedCalculation: boolean;
}): number | null {
  if (args.abstained) return null;
  if (args.citations.length === 0) return 0.2;
  const verified = args.citations.filter((c) => c.status === 'verified').length;
  let score = 0.8 * (verified / args.citations.length);
  if (verified < args.citations.length) score = Math.min(score, 0.4);
  if (args.unverifiedCalculation) score = Math.min(score, 0.5);
  return Math.round(score * 100) / 100;
}
