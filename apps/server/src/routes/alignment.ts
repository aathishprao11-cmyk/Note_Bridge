import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  AlignBody,
  AlignResponse,
  AlignmentQuery,
  AlignmentResponse,
  CourseParams,
  CoverageResponse,
  DEFAULT_CONFIDENCE_WEIGHTS,
  EdgeParams,
  EdgeSignalsResponse,
  PatchEdgeBody,
  PatchEdgeResponse,
  UnitDetailResponse,
  UnitParams,
  type AlignmentEdge,
} from '@gyan/core';
import type { Db } from '../db';
import { courseOfUnit, loadAlignmentState, syncFlags } from './alignment-state';
import { startAlign, type JobRunner } from '../jobs';
import {
  badRequest,
  chunkRefs,
  courseExists,
  fail,
  send,
  toEdge,
  toUnit,
  type EdgeRow,
  type UnitRow,
} from './shared';

/**
 * Alignment routes (Laptop A). Edges, flags and coverage are computed from the stored rows, and
 * PATCH persists the student's correction. POST /align runs the deterministic, model-free matcher
 * (jobs/align-job.ts): it finds the right passages but cannot judge extends / conflicts, so its
 * edges are `covers` with capped confidence. The LLM judge is not built yet.
 */
export function registerAlignmentRoutes(
  app: FastifyInstance,
  db: Db,
  runner: JobRunner,
  opts: { edgeMinConfidence: number },
) {
  const unitsFor = (courseId: string): UnitRow[] =>
    db
      .prepare(
        `SELECT u.* FROM lecture_units u JOIN documents d ON d.id = u.document_id
         WHERE d.course_id = ? ORDER BY d.created_at, d.id, u.unit_no`,
      )
      .all(courseId) as UnitRow[];

  const professorOnly = (unitId: string): boolean =>
    db.prepare('SELECT 1 FROM unit_flags WHERE unit_id = ?').get(unitId) !== undefined;

  app.post('/api/courses/:id/align', async (req, reply) => {
    const params = CourseParams.safeParse(req.params);
    if (!params.success) return badRequest(reply, params.error);
    const body = AlignBody.safeParse(req.body ?? {});
    if (!body.success) return badRequest(reply, body.error);
    if (!courseExists(db, params.data.id)) {
      return fail(reply, 404, 'course_not_found', `No course with id "${params.data.id}"`);
    }
    // Real, model-free alignment (jobs/align-job.ts). A failure (nothing to align) surfaces as a
    // failed job with a clear message, not a silent "Done".
    const jobId = startAlign(runner, db, params.data.id);
    return send(reply, AlignResponse, { jobId }, 202);
  });

  app.get('/api/courses/:id/alignment', async (req, reply) => {
    const params = CourseParams.safeParse(req.params);
    const query = AlignmentQuery.safeParse(req.query);
    if (!params.success) return badRequest(reply, params.error);
    if (!query.success) return badRequest(reply, query.error);
    const courseId = params.data.id;
    if (!courseExists(db, courseId)) {
      return fail(reply, 404, 'course_not_found', `No course with id "${courseId}"`);
    }
    const q = query.data;

    const docs = new Map(
      (
        db
          .prepare('SELECT id, title, kind FROM documents WHERE course_id = ?')
          .all(courseId) as Array<{
          id: string;
          title: string;
          kind: 'book' | 'slides' | 'handwritten' | 'past_paper' | 'syllabus' | 'text_note';
        }>
      ).map((d) => [d.id, d]),
    );
    let units = unitsFor(courseId);
    if (q.documentId) units = units.filter((u) => u.document_id === q.documentId);
    const unitIds = new Set(units.map((u) => u.id));
    // Flags are computed from the stored edges (BRIEF 9.4), never read from a fixture: a unit with
    // no counted edge is professor_only, a book chunk no unit touches is book_only.
    const state = loadAlignmentState(db, courseId, opts.edgeMinConfidence);
    const flagged = state.professorOnlyUnitIds;
    const bookOnlyIds = [...state.bookOnlyChunkIds];

    // Counts ignore the filters so the filter bar can show what each choice would reveal.
    const all = (
      db
        .prepare(
          `SELECT e.* FROM alignment_edges e JOIN lecture_units u ON u.id = e.unit_id
           JOIN documents d ON d.id = u.document_id WHERE d.course_id = ?`,
        )
        .all(courseId) as EdgeRow[]
    ).map(toEdge);
    const counts = {
      covers: all.filter((e) => e.relation === 'covers').length,
      extends: all.filter((e) => e.relation === 'extends').length,
      conflicts: all.filter((e) => e.relation === 'conflicts').length,
      professor_only: flagged.size,
      book_only: bookOnlyIds.length,
    };

    const edges = all.filter(
      (e) =>
        unitIds.has(e.unitId) &&
        (!q.relation || e.relation === q.relation) &&
        (q.minConfidence === undefined || e.confidence >= q.minConfidence) &&
        (q.maxConfidence === undefined || e.confidence <= q.maxConfidence) &&
        (!q.userStatus || e.userStatus === q.userStatus),
    );
    // flag filters narrow the unit list; edge relations narrow the edge list.
    if (q.flag === 'professor_only' || q.relation === 'professor_only') {
      units = units.filter((u) => flagged.has(u.id));
    }
    const chunks = chunkRefs(db, [
      ...new Set([
        ...edges.map((e) => e.chunkId),
        ...(q.flag === 'book_only' || q.relation === 'book_only' || !q.relation ? bookOnlyIds : []),
      ]),
    ]);
    const shownEdges = q.relation === 'professor_only' || q.relation === 'book_only' ? [] : edges;

    return send(reply, AlignmentResponse, {
      courseId,
      units: units.map((u) => ({
        unit: toUnit(u),
        documentTitle: docs.get(u.document_id)?.title ?? '',
        documentKind: docs.get(u.document_id)?.kind ?? 'slides',
        professorOnly: flagged.has(u.id),
      })),
      edges: shownEdges,
      chunks,
      counts,
    });
  });

  const getEdge = (id: string): AlignmentEdge | null => {
    const row = db.prepare('SELECT * FROM alignment_edges WHERE id = ?').get(id) as
      EdgeRow | undefined;
    return row ? toEdge(row) : null;
  };

  app.patch('/api/edges/:id', async (req, reply) => {
    const params = EdgeParams.safeParse(req.params);
    const body = PatchEdgeBody.safeParse(req.body);
    if (!params.success) return badRequest(reply, params.error);
    if (!body.success) return badRequest(reply, body.error);
    const edge = getEdge(params.data.id);
    if (!edge) return fail(reply, 404, 'edge_not_found', `No edge with id "${params.data.id}"`);

    const action = body.data.action;
    const status =
      action === 'confirm' ? 'confirmed' : action === 'reject' ? 'rejected' : 'remapped';
    try {
      db.transaction(() => {
        if (body.data.action === 'remap') {
          // A remap points the edge at the chunk the student says is right. (unit, chunk) is
          // unique, so remapping onto an existing edge is refused rather than merged silently.
          db.prepare('UPDATE alignment_edges SET chunk_id = ?, user_status = ? WHERE id = ?').run(
            body.data.chunkId,
            status,
            edge.id,
          );
        } else {
          db.prepare('UPDATE alignment_edges SET user_status = ? WHERE id = ?').run(
            status,
            edge.id,
          );
        }
        db.prepare('INSERT INTO feedback (id, edge_id, action) VALUES (?, ?, ?)').run(
          `fb_${randomUUID()}`,
          edge.id,
          action,
        );
      })();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (/FOREIGN KEY/i.test(msg)) {
        return fail(reply, 404, 'chunk_not_found', 'That book passage does not exist');
      }
      if (/UNIQUE/i.test(msg)) {
        return fail(reply, 409, 'edge_exists', 'This unit is already matched to that passage');
      }
      throw err;
    }
    // A correction can change which units and chunks are flagged; keep the flag tables current.
    const courseId = courseOfUnit(db, edge.unitId);
    if (courseId) syncFlags(db, courseId, opts.edgeMinConfidence);
    return send(reply, PatchEdgeResponse, getEdge(edge.id));
  });

  app.get('/api/edges/:id/signals', async (req, reply) => {
    const params = EdgeParams.safeParse(req.params);
    if (!params.success) return badRequest(reply, params.error);
    const edge = getEdge(params.data.id);
    if (!edge) return fail(reply, 404, 'edge_not_found', `No edge with id "${params.data.id}"`);
    return send(reply, EdgeSignalsResponse, {
      edgeId: edge.id,
      confidence: edge.confidence,
      signals: edge.signals,
      weights: DEFAULT_CONFIDENCE_WEIGHTS,
      rationale: edge.rationale,
      evidenceUnit: edge.evidenceUnit,
      evidenceBook: edge.evidenceBook,
    });
  });

  app.get('/api/units/:id', async (req, reply) => {
    const params = UnitParams.safeParse(req.params);
    if (!params.success) return badRequest(reply, params.error);
    const row = db.prepare('SELECT * FROM lecture_units WHERE id = ?').get(params.data.id) as
      UnitRow | undefined;
    if (!row) return fail(reply, 404, 'unit_not_found', `No unit with id "${params.data.id}"`);
    const edges = (
      db
        .prepare('SELECT * FROM alignment_edges WHERE unit_id = ? ORDER BY confidence DESC, id')
        .all(row.id) as EdgeRow[]
    ).map(toEdge);
    const siblings = db
      .prepare('SELECT id, unit_no FROM lecture_units WHERE document_id = ? ORDER BY unit_no')
      .all(row.document_id) as Array<{ id: string; unit_no: number }>;
    const at = siblings.findIndex((s) => s.id === row.id);
    const doc = db.prepare('SELECT title FROM documents WHERE id = ?').get(row.document_id) as {
      title: string;
    };
    return send(reply, UnitDetailResponse, {
      unit: toUnit(row),
      documentTitle: doc.title,
      professorOnly: professorOnly(row.id),
      edges,
      chunks: chunkRefs(db, [...new Set(edges.map((e) => e.chunkId))]),
      prevUnitId: siblings[at - 1]?.id ?? null,
      nextUnitId: siblings[at + 1]?.id ?? null,
    });
  });

  // Computed from the stored edges on every request (BRIEF 9.4). Only edges that are confident,
  // not rejected and quote-verified count; confirmed and remapped edges always count.
  app.get('/api/courses/:id/coverage', async (req, reply) => {
    const params = CourseParams.safeParse(req.params);
    if (!params.success) return badRequest(reply, params.error);
    if (!courseExists(db, params.data.id)) {
      return fail(reply, 404, 'course_not_found', `No course with id "${params.data.id}"`);
    }
    const { report } = loadAlignmentState(db, params.data.id, opts.edgeMinConfidence);
    return send(reply, CoverageResponse, report);
  });
}
