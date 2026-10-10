import { describe, expect, it } from 'vitest';
import { ABSTAIN_TEXT, quoteAppearsIn, validateAnswer } from '../src/agent';
import { cite, draft, hit } from './agent-helpers';

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
  it('is kept with status "verified" and gets a computed confidence', () => {
    const r = validateAnswer(draft('Displacement is a change in position [1].', [cite()]), [hit()]);
    expect(r.abstained).toBe(false);
    expect(r.citations).toEqual([
      {
        documentId: 'doc-book',
        chunkId: 'c1',
        page: 41,
        printedPage: 41,
        quote: 'Displacement is the change in position of an object.',
        status: 'verified',
      },
    ]);
    expect(r.content).toBe('Displacement is a change in position [1].');
    expect(r.confidence).toBe(0.8);
    expect(r.unverifiedCalculation).toBe(false);
    expect(r.problems).toEqual([null]);
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
    expect(r.content).toBe('Real claim [1]. Made-up claim.');
    expect(r.content).not.toContain('[2]');
    expect(r.strippedCount).toBe(1);
  });

  it('renumber the survivors so there are no gaps', () => {
    const r = validateAnswer(
      draft('First [1]. Fake [2]. Second [3].', [cite(), invented, second]),
      [hit(), secondHit],
    );
    expect(r.citations.map((c) => c.chunkId)).toEqual(['c1', 'c2']);
    expect(r.content).toBe('First [1]. Fake. Second [2].');
  });

  it('are marked "unverified" instead of stripped when the policy is "mark"', () => {
    const r = validateAnswer(draft('Real [1]. Fake [2].', [cite(), invented]), [hit()], {
      notReturned: 'mark',
    });
    expect(r.citations.map((c) => c.status)).toEqual(['verified', 'unverified']);
    expect(r.problems).toEqual([null, 'not_returned']);
    expect(r.content).toBe('Real [1]. Fake [2].');
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
    expect(r.content).toBe(ABSTAIN_TEXT);
    expect(r.citations).toEqual([]);
    expect(r.confidence).toBeNull();
    expect(r.strippedCount).toBe(1);
  });
});
