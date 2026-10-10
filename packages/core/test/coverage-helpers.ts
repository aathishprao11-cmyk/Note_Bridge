import type { CoverageEdge, CoverageInput } from '../src/align/coverage';

export const MIN = 0.5;
export const edge = (over: Partial<CoverageEdge> & { id: string }): CoverageEdge => ({
  unitId: 'u1',
  chunkId: 'c1',
  relation: 'covers',
  confidence: 0.8,
  userStatus: 'none',
  quoteVerified: true,
  claimVerdict: 'n/a',
  ...over,
});

/** One book of two chapters (pdf pages 1-4 and 5-6, printed = pdf + 2) and three lecture units. */
export function input(edges: CoverageEdge[]): CoverageInput {
  const chunk = (id: string, sectionId: string, page: number, kind = 'text') => ({
    id,
    documentId: 'b',
    kind,
    sectionId,
    pdfPageStart: page,
    pdfPageEnd: page,
    printedPageStart: page + 2,
    printedPageEnd: page + 2,
  });
  return {
    courseId: 'c',
    edgeMinConfidence: MIN,
    unitIds: ['u1', 'u2', 'u3'],
    sections: [
      { id: 'ch1', documentId: 'b', parentId: null, title: 'Ch 1', pageStart: 1, pageEnd: 4 },
      { id: 's1', documentId: 'b', parentId: 'ch1', title: '1.1', pageStart: 1, pageEnd: 2 },
      { id: 's2', documentId: 'b', parentId: 'ch1', title: '1.2', pageStart: 3, pageEnd: 4 },
      { id: 'ch2', documentId: 'b', parentId: null, title: 'Ch 2', pageStart: 5, pageEnd: 6 },
    ],
    chunks: [
      chunk('c1', 's1', 1),
      chunk('c2', 's1', 2),
      chunk('c3', 's2', 3),
      chunk('c4', 'ch2', 5),
      chunk('ex', 'ch2', 6, 'exercise'),
    ],
    edges,
  };
}
