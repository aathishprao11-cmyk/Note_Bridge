import { describe, expect, it } from 'vitest';
import { chatConfidence, validateAnswerText, type Chunk, type Citation } from '../src';

const chunk: Chunk = {
  id: 'c1',
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
};
const base = {
  retrieved: [chunk],
  docTitles: { b: 'University Physics' },
  quoteMatchMin: 0.9,
  ranVerification: false,
  citations: [],
};

describe('answer validation: numbers come from code', () => {
  it('flags a number that nothing supports as an unverified calculation', () => {
    expect(
      validateAnswerText({ ...base, text: 'It takes about 2.02 s.' }).unverifiedCalculation,
    ).toBe(true);
  });

  it('does not flag numbers from the sources, the question, or a verification run', () => {
    const fromSource = validateAnswerText({ ...base, text: 'The formula is v = v0 + a t.' });
    expect(fromSource.unverifiedCalculation).toBe(false);
    const fromQuestion = validateAnswerText({
      ...base,
      text: 'For 20 m we need a formula.',
      knownText: 'a ball falls 20 m',
    });
    expect(fromQuestion.unverifiedCalculation).toBe(false);
    const ran = validateAnswerText({ ...base, text: 'It takes 2.02 s.', ranVerification: true });
    expect(ran.unverifiedCalculation).toBe(false);
  });

  it('ignores page numbers inside citation markers when looking for numbers', () => {
    const r = validateAnswerText({ ...base, text: 'See [University Physics, p.3].' });
    expect(r.unverifiedCalculation).toBe(false);
  });
});

describe('chat confidence', () => {
  const c = (status: 'verified' | 'unverified'): Citation => ({
    documentId: 'b',
    chunkId: 'c1',
    page: 6,
    printedPage: 3,
    quote: 'q',
    status,
  });
  const args = { abstained: false, unverifiedCalculation: false };

  it('is null when abstained', () => {
    expect(
      chatConfidence({ citations: [], abstained: true, unverifiedCalculation: false }),
    ).toBeNull();
  });
  it('is low with no citations', () => {
    expect(chatConfidence({ citations: [], ...args })).toBe(0.2);
  });
  it('is 0.8 when every citation verifies', () => {
    expect(chatConfidence({ citations: [c('verified')], ...args })).toBe(0.8);
  });
  it('is capped at 0.4 when any citation is unverified', () => {
    const score = chatConfidence({ citations: [c('verified'), c('unverified')], ...args });
    expect(score).toBeLessThanOrEqual(0.4);
  });
  it('is capped at 0.5 for an unverified calculation', () => {
    expect(
      chatConfidence({ citations: [c('verified')], ...args, unverifiedCalculation: true }),
    ).toBe(0.5);
  });
});
