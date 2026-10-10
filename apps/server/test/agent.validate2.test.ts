import { describe, expect, it } from 'vitest';
import { validateAnswer } from '../src/agent';
import { cite, draft, hit } from './agent-helpers';

const wrongPage = cite({ page: 50, printedPage: 50 });

describe('validateAnswer: returned but wrong', () => {
  it('marks a wrong page "unverified" (page_mismatch) and keeps it', () => {
    const r = validateAnswer(draft('Real [1]. Wrong page [2].', [cite(), wrongPage]), [hit()]);
    expect(r.citations.map((c) => c.status)).toEqual(['verified', 'unverified']);
    expect(r.problems).toEqual([null, 'page_mismatch']);
    expect(r.unverifiedCount).toBe(1);
    expect(r.strippedCount).toBe(0);
  });

  it('marks a quote that is not in the chunk "unverified" (quote_mismatch)', () => {
    const bad = cite({ quote: 'Velocity is measured in furlongs.' });
    const r = validateAnswer(draft('Real [1]. Bad quote [2].', [cite(), bad]), [hit()]);
    expect(r.problems).toEqual([null, 'quote_mismatch']);
    expect(r.citations[1]?.status).toBe('unverified');
  });

  it('lowers confidence when some citations are unverified', () => {
    const all = validateAnswer(draft('A [1].', [cite()]), [hit()]);
    const half = validateAnswer(draft('A [1]. B [2].', [cite(), wrongPage]), [hit()]);
    expect(half.confidence).toBeLessThan(all.confidence ?? 0);
  });

  it('abstains when ALL citations are unverified', () => {
    const r = validateAnswer(draft('A [1].', [wrongPage]), [hit()]);
    expect(r.abstained).toBe(true);
    expect(r.citations).toEqual([]);
    expect(r.confidence).toBeNull();
  });
});

describe('validateAnswer: other cases', () => {
  it('removes a marker that points at no citation at all', () => {
    const r = validateAnswer(draft('Claim [1] and ghost [7].', [cite()]), [hit()]);
    expect(r.content).toBe('Claim [1] and ghost.');
    expect(r.strippedCount).toBe(1);
  });

  it('keeps an honest abstention as is, with no citations', () => {
    const r = validateAnswer({ text: 'Nothing found.', citations: [], abstained: true }, []);
    expect(r).toMatchObject({
      abstained: true,
      citations: [],
      confidence: null,
      content: 'Nothing found.',
    });
  });

  it('lists a verified citation the text never referenced', () => {
    const r = validateAnswer(draft('No markers here.', [cite()]), [hit()]);
    expect(r.citations).toHaveLength(1);
    expect(r.content).toBe('No markers here.');
  });
});
