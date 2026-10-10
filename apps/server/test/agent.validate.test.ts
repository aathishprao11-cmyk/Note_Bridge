import { describe, expect, it } from 'vitest';
import {
  ABSTAIN_TEXT,
  quoteAppearsIn,
  validateAnswer,
  type AnswerDraft,
  type PageHit,
} from '../src/agent';

const hit = (over: Partial<PageHit> = {}): PageHit => ({
  chunkId: 'c1',
  documentId: 'doc-book',
  documentTitle: 'Book',
  role: 'book',
  page: 41,
  printedPage: 41,
  text: 'Displacement is the change in position of an object.',
  score: 0.8,
  ...over,
});

const cite = (over: Record<string, unknown> = {}) => ({
  documentId: 'doc-book',
  chunkId: 'c1',
  page: 41,
  printedPage: 41,
  quote: 'Displacement is the change in position of an object.',
  ...over,
});

const draft = (text: string, citations: AnswerDraft['citations']): AnswerDraft => ({
  text,
  citations,
  abstained: false,
});

const invented = cite({ chunkId: 'invented', page: 99, printedPage: 99 });
const second = cite({
  chunkId: 'c2',
  page: 42,
  printedPage: 42,
  quote: 'Average velocity is displacement over time.',
});
const secondHit = hit({
  chunkId: 'c2',
  page: 42,
  printedPage: 42,
  text: 'Average velocity is displacement over time.',
});

describe('quoteAppearsIn', () => {
  it('ignores whitespace, curly quotes and dash differences', () => {
    expect(quoteAppearsIn('it’s  a\nvalue', "it's a value")).toBe(true);
    expect(quoteAppearsIn('a – b', 'a - b')).toBe(true);
  });
  it('rejects text that is not in the chunk, and empty quotes', () => {
    expect(quoteAppearsIn('something else', 'Displacement is a vector.')).toBe(false);
    expect(quoteAppearsIn('   ', 'anything')).toBe(false);
  });
});

describe('validateAnswer: a citation that passes every check', () => {
  it('is kept, verified, and gets a computed confidence', () => {
    const r = validateAnswer(draft('Displacement is a change in position [1].', [cite()]), [hit()]);
    expect(r.abstained).toBe(false);
    expect(r.citations).toHaveLength(1);
    expect(r.citations[0]).toMatchObject({ n: 1, verified: true, chunkId: 'c1' });
    expect(r.citations[0]?.reason).toBeUndefined();
    expect(r.text).toBe('Displacement is a change in position [1].');
    expect(r.confidence).toBe(0.8);
    expect(r.unverifiedCount).toBe(0);
    expect(r.strippedCount).toBe(0);
  });
});

describe('validateAnswer: citations no tool returned', () => {
  it('are stripped from the list AND their [n] marker is removed from the text', () => {
    const r = validateAnswer(draft('Real claim [1]. Made-up claim [2].', [cite(), invented]), [
      hit(),
    ]);
    expect(r.citations.map((c) => c.chunkId)).toEqual(['c1']);
    expect(r.text).toBe('Real claim [1]. Made-up claim.');
    expect(r.text).not.toContain('[2]');
    expect(r.strippedCount).toBe(1);
  });

  it('renumber the survivors so there are no gaps', () => {
    const r = validateAnswer(
      draft('First [1]. Fake [2]. Second [3].', [cite(), invented, second]),
      [hit(), secondHit],
    );
    expect(r.citations.map((c) => c.n)).toEqual([1, 2]);
    expect(r.citations.map((c) => c.chunkId)).toEqual(['c1', 'c2']);
    expect(r.text).toBe('First [1]. Fake. Second [2].');
  });

  it('are marked instead of stripped when the policy is "mark"', () => {
    const r = validateAnswer(draft('Real [1]. Fake [2].', [cite(), invented]), [hit()], {
      notReturned: 'mark',
    });
    expect(r.citations).toHaveLength(2);
    expect(r.citations[1]).toMatchObject({ verified: false, reason: 'not_returned' });
    expect(r.text).toBe('Real [1]. Fake [2].');
    expect(r.unverifiedCount).toBe(1);
    expect(r.strippedCount).toBe(0);
  });

  it('count as not returned when the chunk id was returned for a different document', () => {
    const r = validateAnswer(draft('Claim [1].', [cite({ documentId: 'doc-other' })]), [hit()]);
    expect(r.abstained).toBe(true);
    expect(r.citations).toEqual([]);
  });

  it('turn a draft whose only citation was invented into an abstention', () => {
    const r = validateAnswer(draft('Totally unsupported [1].', [invented]), [hit()]);
    expect(r.abstained).toBe(true);
    expect(r.text).toBe(ABSTAIN_TEXT);
    expect(r.citations).toEqual([]);
    expect(r.confidence).toBe(0);
    expect(r.strippedCount).toBe(1);
  });
});
