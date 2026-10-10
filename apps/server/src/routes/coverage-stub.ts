import { demo, type CoverageReport } from '@gyan/core';

const EDGE_MIN_CONFIDENCE = 0.5;

/**
 * STUB (Laptop A, replaced in Phase 1b by the real aggregation in align/coverage.ts): the demo
 * course gets the hand-written fixture numbers; any other course gets an honest empty report.
 */
export function coverageFor(courseId: string): CoverageReport {
  if (courseId === demo.course.id) return demo.coverage;
  return {
    courseId,
    edgeMinConfidence: EDGE_MIN_CONFIDENCE,
    chapters: [],
    totals: {
      units: 0,
      unitsWithEdges: 0,
      professorOnlyUnits: 0,
      bookOnlyChunks: 0,
      conflicts: 0,
      lowConfidenceEdges: 0,
    },
    readingPaths: [],
  };
}
