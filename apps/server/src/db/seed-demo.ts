import { demo, type EmbeddingProvider } from '@gyan/core';
import type { Db } from './index';
import { encodeVector } from './repositories/ingest-store';

export interface SeedResult {
  courseId: string;
  /** True when the demo course already existed and nothing was changed. */
  skipped: boolean;
  counts: Record<string, number>;
}

const ROLE_FOR_KIND: Record<string, string> = {
  book: 'book',
  slides: 'slides',
  handwritten: 'notes',
};
const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;
const TABLES = [
  'documents',
  'pages',
  'sections',
  'chunks',
  'lecture_units',
  'alignment_edges',
  'unit_flags',
  'chunk_flags',
  'exercises',
  'feedback',
];

/**
 * Load the demo course (packages/core/src/fixtures) into SQLite. Idempotent: if the course exists
 * it does nothing, unless `reset` is set, which deletes the course (cascading) and reloads it.
 * Embeddings come from the configured provider (mock in tests and demo mode).
 */
export async function seedDemo(
  db: Db,
  embeddings: EmbeddingProvider,
  opts: { reset?: boolean } = {},
): Promise<SeedResult> {
  const courseId = demo.course.id;
  const exists = db.prepare('SELECT 1 FROM courses WHERE id = ?').get(courseId) !== undefined;
  if (exists && !opts.reset) return { courseId, skipped: true, counts: {} };

  const book = demo.documents.find((d) => d.kind === 'book');
  if (!book) throw new Error('demo fixtures need a book document');
  const sectionById = new Map(demo.sections.map((s) => [s.id, s]));
  const chapterOf = (id: string): string => {
    let s = sectionById.get(id);
    while (s?.parentId) s = sectionById.get(s.parentId);
    return s?.title ?? '';
  };
  const header = (c: (typeof demo.chunks)[number]): string =>
    `${book.title} > ${chapterOf(c.sectionId)} > ${sectionById.get(c.sectionId)?.title ?? ''} [${c.kind}]`;

  // Embeddings are async, so compute them before the single synchronous transaction.
  const chunkVecs = await embeddings.embed(demo.chunks.map((c) => `${header(c)}\n${c.text}`));
  const sectionVecs = await embeddings.embed(demo.sections.map((s) => s.summary));
  const unitVecs = await embeddings.embed(demo.units.map((u) => u.queryText ?? u.text));
  const model = embeddings.id;

  db.transaction(() => {
    db.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
    db.prepare('INSERT INTO courses (id, name, created_at) VALUES (?, ?, ?)').run(
      courseId,
      demo.course.name,
      demo.course.createdAt,
    );
    insertDocuments(db);
    insertBook(db, book.id, book.pageOffset, header, { chunkVecs, sectionVecs, model });
    insertLectures(db, unitVecs);
  })();

  const count = (t: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  return {
    courseId,
    skipped: false,
    counts: Object.fromEntries(TABLES.map((t) => [t, count(t)])),
  };
}

function insertDocuments(db: Db): void {
  const insDoc = db.prepare(
    `INSERT INTO documents (id, course_id, role, kind, title, path, level, meta_json, status,
       extraction_quality, content_hash, page_count, page_offset, created_at, heading_source,
       offset_confidence, warnings, page_quality)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insPage = db.prepare(
    `INSERT INTO pages (id, document_id, pdf_page, printed_page, text, is_scanned, garbled_score,
       ocr_confidence, reextracted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const d of demo.documents) {
    const info = demo.ingest[d.id];
    if (!info) throw new Error(`no ingest fixture for ${d.id}`);
    const handwritten = d.kind === 'handwritten';
    const quality = [];
    for (let p = 1; p <= d.pageCount; p++) {
      const score = info.pageScores?.[p - 1] ?? info.defaultScore;
      quality.push({
        page: p,
        score,
        verdict: score < 0.4 ? 'reject' : score < 0.5 ? 'vision' : 'ok',
        reasons: score < 0.6 ? ['low-confidence handwriting'] : [],
        formulaHeavy: false,
        scanned: handwritten,
      });
    }
    insDoc.run(
      d.id,
      d.courseId,
      ROLE_FOR_KIND[d.kind] ?? 'book',
      d.kind,
      d.title,
      d.path,
      d.level,
      JSON.stringify(d.meta),
      d.status,
      d.extractionQuality,
      d.contentHash,
      d.pageCount,
      d.pageOffset,
      d.createdAt,
      info.headingSource,
      info.offsetConfidence,
      JSON.stringify(info.warnings),
      JSON.stringify(quality),
    );
    for (const q of quality) {
      const printed = q.page + d.pageOffset;
      const text =
        d.kind === 'book'
          ? demo.chunks
              .filter((c) => c.page === q.page)
              .map((c) => c.text)
              .join('\n')
          : (demo.units.find((u) => u.documentId === d.id && u.unitNo === q.page)?.text ?? '');
      insPage.run(
        `${d.id}:p${q.page}`,
        d.id,
        q.page,
        printed >= 1 ? printed : null,
        text,
        handwritten ? 1 : 0,
        1 - q.score,
        handwritten ? q.score : null,
        handwritten && q.score < 0.55 ? 1 : 0,
      );
    }
  }
}

function insertBook(
  db: Db,
  bookId: string,
  offset: number,
  header: (c: (typeof demo.chunks)[number]) => string,
  v: { chunkVecs: number[][]; sectionVecs: number[][]; model: string },
): void {
  const insSection = db.prepare(
    `INSERT INTO sections (id, document_id, parent_id, title, level, page_start, page_end, summary, ordinal)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insSecVec = db.prepare(
    'INSERT INTO section_embeddings (section_id, model, vector) VALUES (?, ?, ?)',
  );
  demo.sections.forEach((s, i) => {
    insSection.run(
      s.id,
      s.documentId,
      s.parentId,
      s.title,
      s.level,
      s.pageStart,
      s.pageEnd,
      s.summary,
      i,
    );
    insSecVec.run(s.id, v.model, encodeVector(v.sectionVecs[i] ?? []));
  });

  const insChunk = db.prepare(
    `INSERT INTO chunks (id, document_id, section_id, parent_id, prev_id, next_id, kind, text,
       context_header, page, token_count, quality, ordinal, pdf_page_end, printed_page_start,
       printed_page_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insVec = db.prepare('INSERT INTO embeddings (chunk_id, model, vector) VALUES (?, ?, ?)');
  const firstInSection = new Map<string, string>();
  for (const c of demo.chunks) {
    if (!firstInSection.has(c.sectionId)) firstInSection.set(c.sectionId, c.id);
  }
  const quality = demo.ingest[bookId]?.defaultScore ?? 1;
  demo.chunks.forEach((c, i) => {
    const parent = firstInSection.get(c.sectionId);
    insChunk.run(
      c.id,
      bookId,
      c.sectionId,
      parent === c.id ? null : (parent ?? null),
      demo.chunks[i - 1]?.id ?? null,
      demo.chunks[i + 1]?.id ?? null,
      c.kind,
      c.text,
      header(c),
      c.page,
      Math.ceil(words(c.text) * 1.3),
      quality,
      i,
      c.page,
      c.page + offset,
      c.page + offset,
    );
    insVec.run(c.id, v.model, encodeVector(v.chunkVecs[i] ?? []));
  });

  const insEx = db.prepare(
    `INSERT INTO exercises (id, document_id, chunk_id, label, statement, has_solution, solution,
       page, printed_page, difficulty, level, topic_tags, verifiable)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const x of demo.exercises) {
    insEx.run(
      x.id,
      x.documentId,
      x.chunkId,
      x.label,
      x.statement,
      x.hasSolution ? 1 : 0,
      x.solution,
      x.page,
      x.printedPage,
      x.difficulty,
      x.level,
      JSON.stringify(x.topicTags),
      x.verifiable ? 1 : 0,
    );
  }
}

function insertLectures(db: Db, unitVecs: number[][]): void {
  const insUnit = db.prepare(
    `INSERT INTO lecture_units (id, document_id, unit_no, title, text, image_path,
       transcription_json, embedding, query_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  demo.units.forEach((u, i) => {
    insUnit.run(
      u.id,
      u.documentId,
      u.unitNo,
      u.title,
      u.text,
      u.imagePath,
      u.transcription ? JSON.stringify(u.transcription) : null,
      encodeVector(unitVecs[i] ?? []),
      u.queryText,
    );
  });

  const insEdge = db.prepare(
    `INSERT INTO alignment_edges (id, unit_id, chunk_id, relation, confidence, signals_json,
       rationale, evidence_unit, evidence_book, quote_verified, claim_verdict, conflict_type,
       user_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const e of demo.edges) {
    insEdge.run(
      e.id,
      e.unitId,
      e.chunkId,
      e.relation,
      e.confidence,
      JSON.stringify(e.signals),
      e.rationale,
      e.evidenceUnit,
      e.evidenceBook,
      e.quoteVerified ? 1 : 0,
      e.claimVerdict,
      e.conflictType,
      e.userStatus,
      e.createdAt,
    );
  }
  const insFb = db.prepare(
    'INSERT INTO feedback (id, edge_id, action, created_at) VALUES (?, ?, ?, ?)',
  );
  for (const f of demo.feedback) insFb.run(f.id, f.edgeId, f.action, f.createdAt);
  const insUF = db.prepare('INSERT INTO unit_flags (id, unit_id, flag) VALUES (?, ?, ?)');
  for (const f of demo.unitFlags) insUF.run(f.id, f.unitId, f.flag);
  const insCF = db.prepare('INSERT INTO chunk_flags (id, chunk_id, flag) VALUES (?, ?, ?)');
  for (const f of demo.chunkFlags) insCF.run(f.id, f.chunkId, f.flag);
}
