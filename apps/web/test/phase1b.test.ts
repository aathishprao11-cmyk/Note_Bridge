import { describe, expect, it } from 'vitest';
import {
  buildMatchPairs,
  buildSectionTree,
  computeCoverage,
  formatConfidence,
  printedPage,
  ratioToPercent,
  relationLabel,
} from '../src/lib/format';
import { mockDocuments, mockEdges, mockSections } from '../src/lib/mockData';

describe('format helpers', () => {
  it('printedPage adds the document pageOffset', () => {
    expect(printedPage({ pageOffset: 2 }, 4)).toBe(6);
    expect(printedPage({ pageOffset: 0 }, 13)).toBe(13);
  });

  it('ratioToPercent rounds to whole percents', () => {
    expect(ratioToPercent(0)).toBe(0);
    expect(ratioToPercent(0.5)).toBe(50);
    expect(ratioToPercent(1)).toBe(100);
    expect(ratioToPercent(0.666)).toBe(67);
  });

  it('formatConfidence renders a percent string', () => {
    expect(formatConfidence(0.91)).toBe('91%');
  });

  it('relationLabel maps each relation to a label', () => {
    expect(relationLabel('covers')).toBe('Covers');
    expect(relationLabel('conflicts')).toBe('Conflicts');
    expect(relationLabel('professor_only')).toBe('Professor only');
  });
});

describe('buildSectionTree', () => {
  it('nests children under their parent and returns roots', () => {
    const roots = buildSectionTree(mockSections);
    const book1 = roots.find((n) => n.section.id === 'book-1');
    expect(book1).toBeDefined();
    expect(book1?.children.map((c) => c.section.id)).toEqual(['book-1-1']);
  });

  it('treats a section with a missing parent as a root (never drops content)', () => {
    const roots = buildSectionTree([
      { ...mockSections[0], id: 'orphan', parentId: 'does-not-exist' },
    ]);
    expect(roots.map((n) => n.section.id)).toContain('orphan');
  });
});

describe('computeCoverage', () => {
  it('derives matched ratio and gap lists from edges', () => {
    const cov = computeCoverage(mockEdges[0].courseId, mockEdges, mockSections, mockDocuments);
    // Professor units: slides-1, slides-1-1, slides-2, slides-3, notes-1 (5).
    // Matched (confirmed/remapped with a book id): slides-1-1 (edge-1), notes-1 (edge-4).
    expect(ratioToPercent(cov.matchedRatio)).toBe(40);
    expect(cov.professorOnly.map((s) => s.id).sort()).toEqual(
      ['slides-1', 'slides-2', 'slides-3'].sort(),
    );
    // Book sections never matched: book-1, book-1-1 (matched via edge-1), book-2, book-3 (matched).
    expect(cov.bookOnly.map((s) => s.id).sort()).toEqual(['book-1', 'book-2'].sort());
  });
});

describe('buildMatchPairs', () => {
  it('pairs each edge with its professor section and resolves the book section', () => {
    const pairs = buildMatchPairs(mockEdges, mockSections);
    expect(pairs).toHaveLength(mockEdges.length);
    const e3 = pairs.find((p) => p.edge.id === 'edge-3');
    expect(e3?.profSection.id).toBe('slides-3');
    expect(e3?.bookSection).toBeNull();
    const e1 = pairs.find((p) => p.edge.id === 'edge-1');
    expect(e1?.bookSection?.id).toBe('book-1-1');
  });

  it('skips edges whose professor section is missing', () => {
    const pairs = buildMatchPairs([{ ...mockEdges[0], profUnitId: 'missing' }], mockSections);
    expect(pairs).toHaveLength(0);
  });
});
