import type { AlignmentEdge, ChapterCoverage, CoverageReport, ReadingPathItem } from '../types';

/**
 * Coverage and flags computed from stored alignment edges (BRIEF 9.4). Pure: no database, no
 * model. Hand-checked expectations live in packages/core/src/fixtures/coverage.json.
 *
 * An edge COUNTS only if it is confident (>= edgeMinConfidence), not rejected, quote-verified
 * and not claim-checked "no". Edges the student confirmed or remapped ALWAYS count (a human
 * decision overrides the model); rejected edges never count.
 */

type Counting = Pick<AlignmentEdge, 'confidence' | 'userStatus' | 'quoteVerified' | 'claimVerdict'>;

const decidedByStudent = (e: Pick<AlignmentEdge, 'userStatus'>): boolean =>
  e.userStatus === 'confirmed' || e.userStatus === 'remapped';

export function countsAsEdge(e: Counting, edgeMinConfidence: number): boolean {
  if (e.userStatus === 'rejected') return false;
  if (decidedByStudent(e)) return true;
  return e.confidence >= edgeMinConfidence && e.quoteVerified && e.claimVerdict !== 'no';
}

/** Shown as low confidence: undecided, not rejected, below the threshold. */
export function isLowConfidence(e: Counting, edgeMinConfidence: number): boolean {
  return e.userStatus !== 'rejected' && !decidedByStudent(e) && e.confidence < edgeMinConfidence;
}

/** BRIEF 11: only claim-check "yes" verdicts are shown as conflicts; the student can override. */
function isShownConflict(e: Pick<AlignmentEdge, 'claimVerdict' | 'userStatus'>): boolean {
  return decidedByStudent(e) || e.claimVerdict === 'yes';
}

export interface CoverageSection {
  id: string;
  documentId: string;
  parentId: string | null;
  title: string;
  pageStart: number;
  pageEnd: number;
}

export interface CoverageChunk {
  id: string;
  documentId: string;
  /** Exercise chunks are never flagged book_only: exercises belong to the Problem Finder. */
  kind: string;
  sectionId: string | null;
  pdfPageStart: number;
  pdfPageEnd: number;
  printedPageStart: number | null;
  printedPageEnd: number | null;
}

export type CoverageEdge = Pick<
  AlignmentEdge,
  | 'id'
  | 'unitId'
  | 'chunkId'
  | 'relation'
  | 'confidence'
  | 'userStatus'
  | 'quoteVerified'
  | 'claimVerdict'
>;

export interface CoverageInput {
  courseId: string;
  edgeMinConfidence: number;
  /** Lecture units of the course, in reading order. */
  unitIds: string[];
  /** Book sections in reading order (parents before children). */
  sections: CoverageSection[];
  chunks: CoverageChunk[];
  edges: CoverageEdge[];
}

export interface AlignmentState {
  report: CoverageReport;
  /** Units with no counted edge. */
  professorOnlyUnitIds: ReadonlySet<string>;
  /** Chunks with no counted edge. */
  bookOnlyChunkIds: ReadonlySet<string>;
}

interface PageRun {
  documentId: string;
  start: number;
  end: number;
  confidence: number;
}

/** Merge overlapping or adjacent page runs of one document; keep the best confidence. */
function mergeRuns(runs: PageRun[]): PageRun[] {
  const sorted = [...runs].sort((a, b) =>
    a.documentId === b.documentId ? a.start - b.start : a.documentId.localeCompare(b.documentId),
  );
  const out: PageRun[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && last.documentId === r.documentId && r.start <= last.end + 1) {
      last.end = Math.max(last.end, r.end);
      last.confidence = Math.max(last.confidence, r.confidence);
    } else out.push({ ...r });
  }
  return out;
}

export function computeAlignmentState(input: CoverageInput): AlignmentState {
  const min = input.edgeMinConfidence;
  const sectionById = new Map(input.sections.map((s) => [s.id, s]));
  const chunkById = new Map(input.chunks.map((c) => [c.id, c]));

  const counted = input.edges.filter((e) => countsAsEdge(e, min));
  const countedByUnit = new Map<string, CoverageEdge[]>();
  const touchedChunks = new Set<string>();
  for (const e of counted) {
    countedByUnit.set(e.unitId, [...(countedByUnit.get(e.unitId) ?? []), e]);
    touchedChunks.add(e.chunkId);
  }

  const professorOnlyUnitIds = new Set(input.unitIds.filter((u) => !countedByUnit.has(u)));
  const bookOnlyChunkIds = new Set(
    input.chunks.filter((c) => c.kind !== 'exercise' && !touchedChunks.has(c.id)).map((c) => c.id),
  );

  /** Walk up from a section to its chapter (top-level section). */
  const chainOf = (sectionId: string | null): string[] => {
    const chain: string[] = [];
    let s = sectionId ? sectionById.get(sectionId) : undefined;
    while (s) {
      chain.push(s.id);
      s = s.parentId ? sectionById.get(s.parentId) : undefined;
    }
    return chain;
  };
  const chapterIdOf = (sectionId: string | null): string | null =>
    chainOf(sectionId).at(-1) ?? null;

  // Sections that contain at least one chunk / one counted chunk (subtree-inclusive).
  const hasChunks = new Set<string>();
  const hasCounted = new Set<string>();
  for (const c of input.chunks) {
    for (const id of chainOf(c.sectionId)) {
      hasChunks.add(id);
      if (touchedChunks.has(c.id)) hasCounted.add(id);
    }
  }

  const chapters: ChapterCoverage[] = [];
  for (const chapter of input.sections.filter((s) => s.parentId === null)) {
    const inChapter = (chunkId: string): boolean =>
      chapterIdOf(chunkById.get(chunkId)?.sectionId ?? null) === chapter.id;

    const matched = new Set<number>();
    for (const e of counted) {
      const c = chunkById.get(e.chunkId);
      if (!c || !inChapter(c.id)) continue;
      for (let p = c.pdfPageStart; p <= c.pdfPageEnd; p++) {
        if (p >= chapter.pageStart && p <= chapter.pageEnd) matched.add(p);
      }
    }
    const totalPages = Math.max(0, chapter.pageEnd - chapter.pageStart + 1);

    const below = input.sections.filter(
      (s) => s.id !== chapter.id && chainOf(s.id).includes(chapter.id),
    );
    const evaluated = below.length > 0 ? below : [chapter];
    chapters.push({
      documentId: chapter.documentId,
      chapter: chapter.title,
      totalPages,
      matchedPages: matched.size,
      coverage: totalPages === 0 ? 0 : matched.size / totalPages,
      bookOnlySections: evaluated.filter((s) => hasChunks.has(s.id) && !hasCounted.has(s.id))
        .length,
      bookOnlyChunks: input.chunks.filter(
        (c) => bookOnlyChunkIds.has(c.id) && chapterIdOf(c.sectionId) === chapter.id,
      ).length,
      conflicts: counted.filter(
        (e) => e.relation === 'conflicts' && isShownConflict(e) && inChapter(e.chunkId),
      ).length,
      lowConfidenceEdges: input.edges.filter((e) => isLowConfidence(e, min) && inChapter(e.chunkId))
        .length,
    });
  }

  // Minimal reading path: the smallest page set covering a unit's counted edges, best first.
  const readingPaths: ReadingPathItem[] = [];
  for (const unitId of input.unitIds) {
    const edges = countedByUnit.get(unitId);
    if (!edges) continue;
    const runs: PageRun[] = [];
    for (const e of edges) {
      const c = chunkById.get(e.chunkId);
      if (!c) continue;
      // Students read printed pages; fall back to the PDF page when none was detected.
      runs.push({
        documentId: c.documentId,
        start: c.printedPageStart ?? c.pdfPageStart,
        end: c.printedPageEnd ?? c.pdfPageEnd,
        confidence: e.confidence,
      });
    }
    const pages = mergeRuns(runs)
      .sort((a, b) => b.confidence - a.confidence || a.start - b.start)
      .map((r) => ({
        documentId: r.documentId,
        printedPageStart: r.start,
        printedPageEnd: r.end,
      }));
    if (pages.length > 0) readingPaths.push({ unitId, pages });
  }

  return {
    report: {
      courseId: input.courseId,
      edgeMinConfidence: min,
      chapters,
      totals: {
        units: input.unitIds.length,
        unitsWithEdges: input.unitIds.length - professorOnlyUnitIds.size,
        professorOnlyUnits: professorOnlyUnitIds.size,
        bookOnlyChunks: bookOnlyChunkIds.size,
        conflicts: counted.filter((e) => e.relation === 'conflicts' && isShownConflict(e)).length,
        lowConfidenceEdges: input.edges.filter((e) => isLowConfidence(e, min)).length,
      },
      readingPaths,
    },
    professorOnlyUnitIds,
    bookOnlyChunkIds,
  };
}
