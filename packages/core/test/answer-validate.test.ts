import { describe, expect, it } from 'vitest';
import {
  UNVERIFIED_CITATION_MARK,
  markUnverifiedRefs,
  quoteMatchScore,
  validateAnswerText,
  verifyQuoteText,
  type Chunk,
  type Citation,
} from '../src';

const chunk = (over: Partial<Chunk> & { id: string }): Chunk => ({
  documentId: 'b',
  sectionId: null,
  parentId: null,
  prevId: null,
  nextId: null,
  kind: 'text',
  text: 'For constant acceleration the velocity changes linearly with time: v = v0 + a t.',
  contextHeader: '',
  page: 6,
  pdfPageStart: 6,
  pdfPageEnd: 6,
  printedPageStart: 3,
  printedPageEnd: 3,
  tokenCount: 20,
  quality: 1,
  ...over,
});
const cite = (over: Partial<Citation> = {}): Citation => ({
  documentId: 'b',
  chunkId: 'c1',
  page: 999,
  printedPage: 999,
  quote: 'the velocity changes linearly with time',
  status: 'verified',
  ...over,
});
const base = {
  retrieved: [chunk({ id: 'c1' })],
  docTitles: { b: 'University Physics' },
  quoteMatchMin: 0.9,
  ranVerification: false,
};

describe('quote verification', () => {
  it('matches a verbatim quote, ignoring case and whitespace', () => {
    expect(quoteMatchScore('The  Velocity\nchanges', 'velocity changes')).toBe(1);
  });
  it('tolerates a small OCR slip at the default 0.9 threshold', () => {
    const src = 'the velocity changes linearly with time';
    expect(verifyQuoteText(src, 'the velocity changes linearly with tlme', 0.9)).toBe(true);
  });
  it('rejects a quote the source does not contain', () => {
    const src = 'velocity changes linearly';
    expect(verifyQuoteText(src, 'force equals mass times jerk', 0.9)).toBe(false);
  });
  it('rejects a quote longer than 20 words even if it matches', () => {
    const long = Array.from({ length: 25 }, (_, i) => `word${i}`).join(' ');
    expect(verifyQuoteText(long, long, 0.9)).toBe(false);
  });
  it('rejects an empty quote', () => {
    expect(quoteMatchScore('anything', '   ')).toBe(0);
  });
});

describe('answer validation: citations', () => {
  it('verifies a citation to a returned chunk and takes pages from the stored chunk', () => {
    const r = validateAnswerText({ ...base, text: 'See the book.', citations: [cite()] });
    expect(r.citations[0]).toMatchObject({ status: 'verified', page: 6, printedPage: 3 });
  });

  it('marks a citation to a chunk no tool returned as unverified', () => {
    const citations = [cite({ chunkId: 'ghost' })];
    const r = validateAnswerText({ ...base, text: 'See the book.', citations });
    expect(r.citations[0]?.status).toBe('unverified');
    expect(r.issues.join(' ')).toMatch(/not returned/);
  });

  it('marks a citation whose quote is not in the chunk as unverified', () => {
    const citations = [cite({ quote: 'gravity bends spacetime around mass' })];
    const r = validateAnswerText({ ...base, text: 'x', citations });
    expect(r.citations[0]?.status).toBe('unverified');
  });
});

describe('answer validation: references in the text', () => {
  it('marks an unmatched [Doc, p.N] "(unverified citation)" and leaves a matched one', () => {
    const text = 'Right [University Physics, p.3]. Wrong [University Physics, p.99].';
    const r = validateAnswerText({ ...base, text, citations: [] });
    expect(r.text).toContain('[University Physics, p.3].');
    expect(r.text).toContain(`[University Physics, p.99] ${UNVERIFIED_CITATION_MARK}`);
    expect(r.text.match(/unverified citation/g)).toHaveLength(1);
  });

  it('marks a page range only when it does not overlap a returned page', () => {
    const overlaps = (_d: string, from: number, to: number) => from <= 4 && to >= 3;
    const out = markUnverifiedRefs('[Book, p.2-4] [Book, p.8-9]', overlaps);
    expect(out).toBe(`[Book, p.2-4] [Book, p.8-9] ${UNVERIFIED_CITATION_MARK}`);
  });

  it('marks a citation to the wrong document', () => {
    const r = validateAnswerText({ ...base, text: 'See [Other Book, p.3].', citations: [] });
    expect(r.text).toContain(UNVERIFIED_CITATION_MARK);
  });
});
