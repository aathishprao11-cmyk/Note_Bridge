/**
 * Pure helpers shared by the Phase 1b screens. No React / DOM / fetch here so they are
 * unit-testable under the repo's node-environment Vitest.
 */
import type { Document, Section, Edge, Relation, Coverage, MatchPair } from './types';

/** printed page number = pdf page index + pageOffset (see Document.pageOffset). */
export function printedPage(doc: Pick<Document, 'pageOffset'>, pdfPage: number): number {
  return pdfPage + doc.pageOffset;
}

/** Round a 0..1 ratio to a whole-number percentage for display. */
export function ratioToPercent(ratio: number): number {
  return Math.round(ratio * 100);
}

/** Human label for a Relation badge on the Alignment Map / Viewer. */
export function relationLabel(relation: Relation): string {
  switch (relation) {
    case 'covers':
      return 'Covers';
    case 'extends':
      return 'Extends';
    case 'conflicts':
      return 'Conflicts';
    case 'professor_only':
      return 'Professor only';
    case 'book_only':
      return 'Book only';
  }
}

/** Format a computed confidence (0..1) as a percentage string. */
export function formatConfidence(confidence: number): string {
  return `${ratioToPercent(confidence)}%`;
}

export interface SectionTreeNode {
  section: Section;
  children: SectionTreeNode[];
}

/**
 * Turn the flat `Section[]` (each with a `parentId`) into a tree. Sections whose parent is
 * missing are treated as roots so the viewer never drops content. Order is stable (input order).
 */
export function buildSectionTree(sections: Section[]): SectionTreeNode[] {
  const nodes = new Map<string, SectionTreeNode>();
  for (const section of sections) nodes.set(section.id, { section, children: [] });

  const roots: SectionTreeNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.section.parentId;
    const parent = parentId === null ? undefined : nodes.get(parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/**
 * Compute the Coverage view model from edges + sections. Matched = a professor unit whose edge
 * has a non-null `bookSectionId` and status `confirmed` or `remapped`.
 *
 * This mirrors the eventual `/coverage` contract; until that lands it is derived locally.
 */
export function computeCoverage(
  courseId: string,
  edges: Edge[],
  sections: Section[],
  documents: Document[],
): Coverage {
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const docById = new Map(documents.map((d) => [d.id, d]));

  const isProfessorRole = (sectionId: string): boolean => {
    const doc = docById.get(sectionById.get(sectionId)?.documentId ?? '');
    return doc?.kind === 'slides' || doc?.kind === 'handwritten';
  };

  const matchedProfIds = new Set<string>();
  const matchedBookIds = new Set<string>();
  for (const edge of edges) {
    if (edge.bookSectionId && (edge.status === 'confirmed' || edge.status === 'remapped')) {
      matchedProfIds.add(edge.profUnitId);
      matchedBookIds.add(edge.bookSectionId);
    }
  }

  const professorSections = sections.filter((s) => isProfessorRole(s.id));
  const bookSections = sections.filter((s) => {
    const doc = docById.get(s.documentId);
    return doc?.kind === 'book';
  });

  const professorOnly = professorSections.filter((s) => !matchedProfIds.has(s.id));
  const bookOnly = bookSections.filter((s) => !matchedBookIds.has(s.id));

  const matchedProfCount = professorSections.filter((s) => matchedProfIds.has(s.id)).length;
  const matchedRatio =
    professorSections.length === 0 ? 0 : matchedProfCount / professorSections.length;

  return { courseId, matchedRatio, professorOnly, bookOnly };
}

/** Pair each professor-unit edge with its two sections for the side-by-side Viewer. */
export function buildMatchPairs(edges: Edge[], sections: Section[]): MatchPair[] {
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const pairs: MatchPair[] = [];
  for (const edge of edges) {
    const profSection = sectionById.get(edge.profUnitId);
    if (!profSection) continue;
    const bookSection = edge.bookSectionId ? (sectionById.get(edge.bookSectionId) ?? null) : null;
    pairs.push({ edge, profSection, bookSection });
  }
  return pairs;
}
