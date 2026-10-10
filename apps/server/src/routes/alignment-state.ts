import { computeAlignmentState, type AlignmentState } from '@gyan/core';
import type { Db } from '../db';
import { toEdge, type EdgeRow } from './shared';

/**
 * Load a course's stored rows and compute coverage and the professor_only / book_only flags from
 * them (BRIEF 9.4). Nothing here is fixture data: change an edge and the numbers change.
 */
export function loadAlignmentState(
  db: Db,
  courseId: string,
  edgeMinConfidence: number,
): AlignmentState {
  const unitIds = (
    db
      .prepare(
        `SELECT u.id FROM lecture_units u JOIN documents d ON d.id = u.document_id
         WHERE d.course_id = ? ORDER BY d.created_at, d.id, u.unit_no`,
      )
      .all(courseId) as Array<{ id: string }>
  ).map((u) => u.id);

  const sections = (
    db
      .prepare(
        `SELECT s.id, s.document_id, s.parent_id, s.title, s.page_start, s.page_end
         FROM sections s JOIN documents d ON d.id = s.document_id
         WHERE d.course_id = ? AND d.kind = 'book' ORDER BY d.created_at, d.id, s.ordinal`,
      )
      .all(courseId) as Array<{
      id: string;
      document_id: string;
      parent_id: string | null;
      title: string;
      page_start: number;
      page_end: number;
    }>
  ).map((s) => ({
    id: s.id,
    documentId: s.document_id,
    parentId: s.parent_id,
    title: s.title,
    pageStart: s.page_start,
    pageEnd: s.page_end,
  }));

  const chunks = (
    db
      .prepare(
        `SELECT c.id, c.document_id, c.kind, c.section_id, c.page, c.pdf_page_end,
                c.printed_page_start, c.printed_page_end
         FROM chunks c JOIN documents d ON d.id = c.document_id
         WHERE d.course_id = ? AND d.kind = 'book' ORDER BY c.document_id, c.ordinal`,
      )
      .all(courseId) as Array<{
      id: string;
      document_id: string;
      kind: string;
      section_id: string | null;
      page: number;
      pdf_page_end: number | null;
      printed_page_start: number | null;
      printed_page_end: number | null;
    }>
  ).map((c) => ({
    id: c.id,
    documentId: c.document_id,
    kind: c.kind,
    sectionId: c.section_id,
    pdfPageStart: c.page,
    pdfPageEnd: c.pdf_page_end ?? c.page,
    printedPageStart: c.printed_page_start,
    printedPageEnd: c.printed_page_end,
  }));

  const edges = (
    db
      .prepare(
        `SELECT e.* FROM alignment_edges e JOIN lecture_units u ON u.id = e.unit_id
         JOIN documents d ON d.id = u.document_id WHERE d.course_id = ?`,
      )
      .all(courseId) as EdgeRow[]
  ).map(toEdge);

  return computeAlignmentState({
    courseId,
    edgeMinConfidence,
    unitIds,
    sections,
    chunks,
    edges,
  });
}

/**
 * Rewrite unit_flags and chunk_flags from the computed state ("recomputed after alignment").
 * Called after seeding and after every student correction so the flag tables other code reads
 * never go stale.
 */
export function syncFlags(db: Db, courseId: string, edgeMinConfidence: number): AlignmentState {
  const state = loadAlignmentState(db, courseId, edgeMinConfidence);
  db.transaction(() => {
    db.prepare(
      `DELETE FROM unit_flags WHERE unit_id IN
         (SELECT u.id FROM lecture_units u JOIN documents d ON d.id = u.document_id WHERE d.course_id = ?)`,
    ).run(courseId);
    db.prepare(
      `DELETE FROM chunk_flags WHERE chunk_id IN
         (SELECT c.id FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.course_id = ?)`,
    ).run(courseId);
    const insU = db.prepare('INSERT INTO unit_flags (id, unit_id, flag) VALUES (?, ?, ?)');
    for (const id of state.professorOnlyUnitIds) insU.run(`uf_${id}`, id, 'professor_only');
    const insC = db.prepare('INSERT INTO chunk_flags (id, chunk_id, flag) VALUES (?, ?, ?)');
    for (const id of state.bookOnlyChunkIds) insC.run(`cf_${id}`, id, 'book_only');
  })();
  return state;
}

/** The course a lecture unit belongs to (for unit routes that only have the unit id). */
export function courseOfUnit(db: Db, unitId: string): string | null {
  const r = db
    .prepare(
      `SELECT d.course_id AS id FROM lecture_units u JOIN documents d ON d.id = u.document_id
       WHERE u.id = ?`,
    )
    .get(unitId) as { id: string } | undefined;
  return r?.id ?? null;
}
