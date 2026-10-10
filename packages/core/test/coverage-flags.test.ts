import { describe, expect, it } from 'vitest';
import { computeAlignmentState } from '../src/align/coverage';
import { edge, input } from './coverage-helpers';

describe('computeAlignmentState: flags, conflicts, reading path', () => {
  it('flags units with no counted edge professor_only and chunks nobody touches book_only', () => {
    const s = computeAlignmentState(input([edge({ id: 'e1', chunkId: 'c1' })]));
    expect([...s.professorOnlyUnitIds].sort()).toEqual(['u2', 'u3']);
    expect([...s.bookOnlyChunkIds].sort()).toEqual(['c2', 'c3', 'c4']);
    expect(s.report.totals).toMatchObject({ units: 3, unitsWithEdges: 1, professorOnlyUnits: 2 });
  });

  it('never flags an exercise chunk as book_only', () => {
    const s = computeAlignmentState(input([]));
    expect(s.bookOnlyChunkIds.has('ex')).toBe(false);
    expect(s.bookOnlyChunkIds.has('c4')).toBe(true);
  });

  it('un-flags a unit once the student confirms a weak edge for it', () => {
    const weak = edge({ id: 'e1', unitId: 'u2', chunkId: 'c4', confidence: 0.2 });
    expect(computeAlignmentState(input([weak])).professorOnlyUnitIds.has('u2')).toBe(true);
    const after = computeAlignmentState(input([{ ...weak, userStatus: 'confirmed' }]));
    expect(after.professorOnlyUnitIds.has('u2')).toBe(false);
    expect(after.report.chapters[1]?.matchedPages).toBe(1);
  });

  it('counts book_only sections: sections of a chapter with no counted chunk', () => {
    const s = computeAlignmentState(input([edge({ id: 'e1', chunkId: 'c1' })]));
    expect(s.report.chapters[0]?.bookOnlySections).toBe(1); // 1.2 untouched
  });

  it('shows conflicts only for claim verdict yes (or a student decision)', () => {
    const conflict = (
      id: string,
      chunkId: string,
      unitId: string,
      claimVerdict: 'yes' | 'partial' | 'no',
    ) => edge({ id, chunkId, unitId, relation: 'conflicts', claimVerdict });
    const s = computeAlignmentState(
      input([
        conflict('a', 'c1', 'u1', 'yes'),
        conflict('b', 'c2', 'u2', 'partial'),
        conflict('c', 'c3', 'u3', 'no'),
      ]),
    );
    expect(s.report.totals.conflicts).toBe(1);
  });

  it('builds a reading path in printed pages, merging adjacent pages', () => {
    const s = computeAlignmentState(
      input([
        edge({ id: 'a', chunkId: 'c1', confidence: 0.6 }),
        edge({ id: 'b', chunkId: 'c2', confidence: 0.7 }),
        edge({ id: 'c', chunkId: 'c4', confidence: 0.9 }),
      ]),
    );
    const path = s.report.readingPaths.find((p) => p.unitId === 'u1');
    // c1 and c2 are printed pages 3 and 4 (adjacent, merged, best confidence 0.7); c4 is printed 7
    // (confidence 0.9). Best first, so the single page 7 leads.
    expect(path?.pages).toEqual([
      { documentId: 'b', printedPageStart: 7, printedPageEnd: 7 },
      { documentId: 'b', printedPageStart: 3, printedPageEnd: 4 },
    ]);
  });

  it('has no reading path for a unit with no counted edge', () => {
    const s = computeAlignmentState(input([edge({ id: 'a', chunkId: 'c1' })]));
    expect(s.report.readingPaths.map((p) => p.unitId)).toEqual(['u1']);
  });
});
