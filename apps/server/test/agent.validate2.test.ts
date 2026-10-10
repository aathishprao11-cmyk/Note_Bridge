import { describe, expect, it } from 'vitest';
import { validateAnswer, type AnswerDraft, type PageHit } from '../src/agent';

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

const wrongPage = cite({ page: 50, printedPage: 50 });

describe('validateAnswer: returned but wrong', () => {
  it('marks a wrong page as unverified (page_mismatch) and keeps it', () => {
    const r = validateAnswer(draft('Real [1]. Wrong page [2].', [cite(), wrongPage]), [hit()]);
    expect(r.citations).toHaveLength(2);
    expect(r.citations[1]).toMatchObject({ verified: false, reason: 'page_mismatch' });
    expect(r.unverifiedCount).toBe(1);
    expect(r.strippedCount).toBe(0);
  });

  it('marks a quote that is not in the chunk as unverified (quote_mismatch)', () => {
    const bad = cite({ quote: 'Velocity is measured in furlongs.' });
    const r = validateAnswer(draft('Real [1]. Bad quote [2].', [cite(), bad]), [hit()]);
    expect(r.citations[1]).toMatchObject({ verified: false, reason: 'quote_mismatch' });
  });

  it('lowers confidence when some citations are unverified', () => {
    const all = validateAnswer(draft('A [1].', [cite()]), [hit()]);
    const half = validateAnswer(draft('A [1]. B [2].', [cite(), wrongPage]), [hit()]);
    expect(half.confidence).toBeLessThan(all.confidence);
  });

  it('abstains when ALL citations are unverified', () => {
    const r = validateAnswer(draft('A [1].', [wrongPage]), [hit()]);
    expect(r.abstained).toBe(true);
    expect(r.citations).toEqual([]);
  });
});

describe('validateAnswer: other cases', () => {
  it('removes a marker that points at no citation at all', () => {
    const r = validateAnswer(draft('Claim [1] and ghost [7].', [cite()]), [hit()]);
    expect(r.text).toBe('Claim [1] and ghost.');
    expect(r.strippedCount).toBe(1);
  });

  it('keeps an honest abstention as is, with no citations', () => {
    const r = validateAnswer({ text: 'Nothing found.', citations: [], abstained: true }, []);
    expect(r).toMatchObject({
      abstained: true,
      citations: [],
      confidence: 0,
      text: 'Nothing found.',
    });
  });

  it('lists a verified citation the text never referenced', () => {
    const r = validateAnswer(draft('No markers here.', [cite()]), [hit()]);
    expect(r.citations).toHaveLength(1);
    expect(r.text).toBe('No markers here.');
  });
});
