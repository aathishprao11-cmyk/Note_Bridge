import { describe, expect, it } from 'vitest';
import { computeAlignmentState, countsAsEdge, isLowConfidence } from '../src/align/coverage';
import { MIN, edge, input } from './coverage-helpers';

describe('which edges count (BRIEF 9.4)', () => {
  it('counts a confident, verified, undecided edge', () => {
    expect(countsAsEdge(edge({ id: 'a' }), MIN)).toBe(true);
  });
  it('does not count a low-confidence edge', () => {
    expect(countsAsEdge(edge({ id: 'a', confidence: 0.49 }), MIN)).toBe(false);
    expect(countsAsEdge(edge({ id: 'a', confidence: 0.5 }), MIN)).toBe(true); // boundary
  });
  it('does not count an unverified quote, however confident', () => {
    expect(countsAsEdge(edge({ id: 'a', quoteVerified: false, confidence: 0.99 }), MIN)).toBe(
      false,
    );
  });
  it('does not count a claim the claim-check said no to', () => {
    expect(countsAsEdge(edge({ id: 'a', claimVerdict: 'no' }), MIN)).toBe(false);
  });
  it('never counts a rejected edge', () => {
    expect(countsAsEdge(edge({ id: 'a', userStatus: 'rejected' }), MIN)).toBe(false);
  });
  it('always counts confirmed and remapped edges, even weak or unverified ones', () => {
    for (const userStatus of ['confirmed', 'remapped'] as const) {
      const weak = edge({ id: 'a', userStatus, confidence: 0.1, quoteVerified: false });
      expect(countsAsEdge(weak, MIN)).toBe(true);
    }
  });
  it('reports low confidence only for undecided, non-rejected edges below the threshold', () => {
    expect(isLowConfidence(edge({ id: 'a', confidence: 0.3 }), MIN)).toBe(true);
    const rejected = edge({ id: 'a', confidence: 0.3, userStatus: 'rejected' });
    expect(isLowConfidence(rejected, MIN)).toBe(false);
    const confirmed = edge({ id: 'a', confidence: 0.3, userStatus: 'confirmed' });
    expect(isLowConfidence(confirmed, MIN)).toBe(false);
  });
});

describe('computeAlignmentState: coverage', () => {
  it('computes chapter coverage as matched pages over total pages', () => {
    const s = computeAlignmentState(
      input([edge({ id: 'e1', chunkId: 'c1' }), edge({ id: 'e2', chunkId: 'c2', unitId: 'u2' })]),
    );
    expect(s.report.chapters.find((c) => c.chapter === 'Ch 1')).toMatchObject({
      totalPages: 4,
      matchedPages: 2,
      coverage: 0.5,
    });
    expect(s.report.chapters.find((c) => c.chapter === 'Ch 2')?.matchedPages).toBe(0);
  });

  it('counts a page once however many edges point at it', () => {
    const s = computeAlignmentState(
      input([edge({ id: 'e1', chunkId: 'c1' }), edge({ id: 'e2', chunkId: 'c1', unitId: 'u2' })]),
    );
    expect(s.report.chapters[0]?.matchedPages).toBe(1);
  });

  it('ignores edges that do not count', () => {
    const s = computeAlignmentState(
      input([
        edge({ id: 'e1', chunkId: 'c1', quoteVerified: false }),
        edge({ id: 'e2', chunkId: 'c2', userStatus: 'rejected' }),
        edge({ id: 'e3', chunkId: 'c3', confidence: 0.2 }),
      ]),
    );
    expect(s.report.chapters[0]?.matchedPages).toBe(0);
    expect(s.report.chapters[0]?.coverage).toBe(0);
  });
});
