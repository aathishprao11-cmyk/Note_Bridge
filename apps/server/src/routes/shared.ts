import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import type { AlignmentEdge, ChunkRef, Course, LectureUnit, UnitTranscription } from '@gyan/core';
import type { Db } from '../db';

export function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

/**
 * Validate a response against its contract schema before sending. A route that drifts from the
 * contract fails loudly (500 contract_violation) instead of silently breaking the web app.
 */
export function send<S extends z.ZodType>(
  reply: FastifyReply,
  schema: S,
  data: unknown,
  status = 200,
) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return fail(
      reply,
      500,
      'contract_violation',
      `Response does not match the API contract: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return reply.code(status).send(parsed.data);
}

export function badRequest(reply: FastifyReply, error: z.ZodError) {
  return fail(
    reply,
    400,
    'bad_request',
    error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
  );
}

export const courseExists = (db: Db, id: string): boolean =>
  db.prepare('SELECT 1 FROM courses WHERE id = ?').get(id) !== undefined;

export function toCourse(r: { id: string; name: string; created_at: string }): Course {
  return { id: r.id, name: r.name, createdAt: r.created_at };
}

export interface EdgeRow {
  id: string;
  unit_id: string;
  chunk_id: string;
  relation: AlignmentEdge['relation'];
  confidence: number;
  signals_json: string;
  rationale: string;
  evidence_unit: string;
  evidence_book: string;
  quote_verified: number;
  claim_verdict: AlignmentEdge['claimVerdict'];
  conflict_type: AlignmentEdge['conflictType'];
  user_status: AlignmentEdge['userStatus'];
  created_at: string;
}

export function toEdge(r: EdgeRow): AlignmentEdge {
  return {
    id: r.id,
    unitId: r.unit_id,
    chunkId: r.chunk_id,
    relation: r.relation,
    confidence: r.confidence,
    signals: JSON.parse(r.signals_json),
    rationale: r.rationale,
    evidenceUnit: r.evidence_unit,
    evidenceBook: r.evidence_book,
    quoteVerified: r.quote_verified === 1,
    claimVerdict: r.claim_verdict,
    conflictType: r.conflict_type,
    userStatus: r.user_status,
    createdAt: r.created_at,
  };
}

export interface UnitRow {
  id: string;
  document_id: string;
  unit_no: number;
  title: string;
  text: string;
  image_path: string | null;
  transcription_json: string | null;
  query_text: string | null;
}

export function toUnit(r: UnitRow): LectureUnit {
  return {
    id: r.id,
    documentId: r.document_id,
    unitNo: r.unit_no,
    title: r.title,
    text: r.text,
    imagePath: r.image_path,
    transcription: r.transcription_json
      ? (JSON.parse(r.transcription_json) as UnitTranscription)
      : null,
    queryText: r.query_text,
  };
}

interface ChunkJoinRow {
  id: string;
  document_id: string;
  title: string;
  section_id: string | null;
  kind: ChunkRef['kind'];
  text: string;
  page: number;
  pdf_page_end: number | null;
  printed_page_start: number | null;
  printed_page_end: number | null;
  quality: number;
  book_only: number;
}

const SNIPPET_WORDS = 40;

/** Resolve chunk ids to display refs. Names and page numbers come from the DB, never a model. */
export function chunkRefs(db: Db, ids: string[]): Record<string, ChunkRef> {
  const out: Record<string, ChunkRef> = {};
  if (ids.length === 0) return out;
  const marks = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT c.id, c.document_id, d.title, c.section_id, c.kind, c.text, c.page, c.pdf_page_end,
              c.printed_page_start, c.printed_page_end, c.quality,
              EXISTS (SELECT 1 FROM chunk_flags f WHERE f.chunk_id = c.id) AS book_only
       FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.id IN (${marks})`,
    )
    .all(...ids) as ChunkJoinRow[];
  const sections = new Map(
    (
      db.prepare('SELECT id, parent_id, title FROM sections').all() as Array<{
        id: string;
        parent_id: string | null;
        title: string;
      }>
    ).map((s) => [s.id, s]),
  );
  for (const r of rows) {
    let sec = r.section_id ? sections.get(r.section_id) : undefined;
    const section = sec?.title ?? null;
    while (sec?.parent_id) sec = sections.get(sec.parent_id);
    const words = r.text.split(/\s+/);
    out[r.id] = {
      id: r.id,
      documentId: r.document_id,
      documentTitle: r.title,
      chapter: sec?.title ?? null,
      section,
      kind: r.kind,
      snippet:
        words.length > SNIPPET_WORDS ? `${words.slice(0, SNIPPET_WORDS).join(' ')}…` : r.text,
      pdfPageStart: r.page,
      pdfPageEnd: r.pdf_page_end ?? r.page,
      printedPageStart: r.printed_page_start,
      printedPageEnd: r.printed_page_end,
      quality: r.quality,
      bookOnly: r.book_only === 1,
    };
  }
  return out;
}
