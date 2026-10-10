import { randomUUID } from 'node:crypto';
import {
  alignLexical,
  computeConfidence,
  verifyQuoteText,
  type Passage,
  type Query,
} from '@gyan/core';
import type { Db } from '../db';
import type { JobRunner } from './runner';

/**
 * "Run alignment" for a course, with NO model: deterministic TF-IDF matching of every lecture
 * unit against every book chunk. It writes real alignment_edges for the course, so the map,
 * coverage and flags all work on uploaded files. What it cannot do is judge the RELATIONSHIP:
 * every edge is `covers` with claim_verdict 'n/a' (it never invents a conflict), and confidence
 * is capped (`lexical_only`) because no model judge ran. A student's confirmed / rejected /
 * remapped edges are kept: re-running only replaces edges that are still undecided.
 */

export interface AlignResult {
  units: number;
  passages: number;
  edgesWritten: number;
  edgesKept: number;
}

interface UnitRow {
  id: string;
  document_id: string;
  text: string;
  title: string;
  quality: number | null;
}

interface ChunkRow {
  id: string;
  text: string;
  context_header: string;
  quality: number;
}

export function alignCourse(
  db: Db,
  courseId: string,
  report: (progress: number, message: string) => void = () => undefined,
): AlignResult {
  const units = db
    .prepare(
      `SELECT u.id, u.document_id, u.text, u.title, d.extraction_quality AS quality
       FROM lecture_units u JOIN documents d ON d.id = u.document_id
       WHERE d.course_id = ? ORDER BY d.created_at, d.id, u.unit_no`,
    )
    .all(courseId) as UnitRow[];
  const chunks = db
    .prepare(
      `SELECT c.id, c.text, c.context_header, c.quality FROM chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE d.course_id = ? AND d.kind = 'book' AND c.kind <> 'exercise' ORDER BY c.ordinal`,
    )
    .all(courseId) as ChunkRow[];

  if (units.length === 0) {
    throw new Error(
      'No lecture units to align. Upload slides or notes first (and re-upload any that were added before this version).',
    );
  }
  if (chunks.length === 0) throw new Error('No book chunks to align against. Upload a book first.');

  report(0.2, `Matching ${units.length} lecture units against ${chunks.length} book passages`);
  const queries: Query[] = units.map((u) => ({ id: u.id, text: `${u.title}\n${u.text}` }));
  const passages: Passage[] = chunks.map((c) => ({
    id: c.id,
    text: c.text,
    header: c.context_header,
  }));
  const matches = alignLexical(queries, passages);
  const chunkById = new Map(chunks.map((c) => [c.id, c]));

  const kept = db
    .prepare(
      `SELECT e.unit_id, e.chunk_id FROM alignment_edges e JOIN lecture_units u ON u.id = e.unit_id
       JOIN documents d ON d.id = u.document_id
       WHERE d.course_id = ? AND e.user_status <> 'none'`,
    )
    .all(courseId) as Array<{ unit_id: string; chunk_id: string }>;
  const keptKeys = new Set(kept.map((k) => `${k.unit_id}|${k.chunk_id}`));

  let written = 0;
  db.transaction(() => {
    // Only undecided edges are replaced; the student's decisions survive a re-run.
    db.prepare(
      `DELETE FROM alignment_edges WHERE user_status = 'none' AND unit_id IN
         (SELECT u.id FROM lecture_units u JOIN documents d ON d.id = u.document_id WHERE d.course_id = ?)`,
    ).run(courseId);
    const ins = db.prepare(
      `INSERT INTO alignment_edges (id, unit_id, chunk_id, relation, confidence, signals_json,
         rationale, evidence_unit, evidence_book, quote_verified, claim_verdict, conflict_type,
         user_status) VALUES (?, ?, ?, 'covers', ?, ?, ?, ?, ?, ?, 'n/a', NULL, 'none')`,
    );
    for (const u of units) {
      const list = matches.get(u.id) ?? [];
      const top = list[0]?.score ?? 0;
      list.forEach((m, i) => {
        if (keptKeys.has(`${u.id}|${m.passageId}`)) return;
        const chunk = chunkById.get(m.passageId);
        if (!chunk) return;
        // The quotes are verbatim sentences, but verify them with the same code as everything else.
        const verified =
          verifyQuoteText(u.text, m.unitQuote, 0.9) &&
          verifyQuoteText(chunk.text, m.bookQuote, 0.9);
        const next = list[i + 1]?.score ?? 0;
        const scored = computeConfidence(
          {
            retrievalScore: Math.min(1, m.score * 2),
            quoteVerified: verified,
            judgeAgreement: 0,
            top1Gap: i === 0 ? Math.min(1, Math.max(0, top - next)) : 0,
            extractionQuality: Math.min(u.quality ?? 1, chunk.quality),
            llmSelfReport: 0,
          },
          { judgeRan: false },
        );
        ins.run(
          `edge_${randomUUID()}`,
          u.id,
          m.passageId,
          scored.confidence,
          JSON.stringify(scored.signals),
          'Matched by shared vocabulary only (no model judge ran); the relationship is not assessed.',
          m.unitQuote,
          m.bookQuote,
          verified ? 1 : 0,
        );
        written += 1;
      });
    }
  })();

  report(1, `Wrote ${written} edges for ${units.length} units`);
  return {
    units: units.length,
    passages: chunks.length,
    edgesWritten: written,
    edgesKept: kept.length,
  };
}

/** Queue the align job. The job fails (with a clear message) if there is nothing to align. */
export function startAlign(runner: JobRunner, db: Db, courseId: string): string {
  return runner.start('align', null, async (report) => {
    alignCourse(db, courseId, report);
  });
}
