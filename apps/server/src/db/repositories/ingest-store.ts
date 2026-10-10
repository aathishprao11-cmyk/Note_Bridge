import { createHash } from 'node:crypto';
import type { Chunk, Exercise, IngestResult, Section } from '@gyan/core';
import type { Db } from '../index';

export const sectionId = (documentId: string, index: number): string =>
  'sec_' + createHash('sha1').update(`${documentId}|${index}`).digest('hex').slice(0, 16);

/** Float32 little-endian, the on-disk format of embeddings.vector. */
export function encodeVector(v: number[]): Buffer {
  return Buffer.from(new Float32Array(v).buffer);
}

export function decodeVector(b: Buffer): number[] {
  return Array.from(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4));
}

interface SectionRow {
  id: string;
  document_id: string;
  parent_id: string | null;
  title: string;
  level: number;
  page_start: number;
  page_end: number;
  summary: string | null;
}

interface ChunkRow {
  id: string;
  document_id: string;
  section_id: string | null;
  parent_id: string | null;
  prev_id: string | null;
  next_id: string | null;
  kind: Chunk['kind'];
  text: string;
  context_header: string;
  page: number;
  token_count: number;
  quality: number;
  pdf_page_end: number | null;
  printed_page_start: number | null;
  printed_page_end: number | null;
}

interface ExerciseRow {
  id: string;
  document_id: string;
  chunk_id: string | null;
  label: string;
  statement: string;
  has_solution: number;
  solution: string | null;
  page: number;
  printed_page: number | null;
  difficulty: number | null;
  level: Exercise['level'];
  topic_tags: string;
  verifiable: number;
}

/** Mean page quality 0..1 across readable pages; null when there are none. */
function meanQuality(result: IngestResult): number | null {
  const q = result.pageQuality.filter((p) => p.verdict !== 'reject');
  return q.length === 0 ? null : q.reduce((s, p) => s + p.score, 0) / q.length;
}

/** Reads and writes everything an ingested document produces. */
export class IngestStore {
  constructor(private readonly db: Db) {}

  /**
   * Write the whole result in ONE transaction: either the document is fully stored and marked
   * 'ready', or nothing is stored. Rows are inserted parents first so foreign keys hold.
   */
  save(documentId: string, result: IngestResult): void {
    const db = this.db;
    db.transaction(() => {
      db.prepare(
        `UPDATE documents SET status = 'ready', page_count = ?, page_offset = ?, offset_confidence = ?,
           heading_source = ?, warnings = ?, page_quality = ?, extraction_quality = ? WHERE id = ?`,
      ).run(
        result.pageCount,
        result.pageOffset,
        result.offset.confidence,
        result.headingSource,
        JSON.stringify(result.warnings),
        JSON.stringify(result.pageQuality),
        meanQuality(result),
        documentId,
      );

      if (result.manualTranscript) {
        db.prepare(
          `UPDATE documents SET extraction_quality = NULL,
          meta_json = json_set(meta_json, '$.transcriptionSource', 'manual') WHERE id = ?`,
        ).run(documentId);
      }
      const pageTexts = new Map(result.pageTexts?.map((p) => [p.page, p.text]) ?? []);
      const insPage = db.prepare(
        `INSERT INTO pages (id, document_id, pdf_page, printed_page, text, is_scanned, garbled_score)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const q of result.pageQuality) {
        insPage.run(
          `${documentId}:p${q.page}`,
          documentId,
          q.page,
          q.page + result.pageOffset,
          pageTexts.get(q.page) ?? '',
          q.scanned ? 1 : 0,
          1 - q.score,
        );
      }

      const insSection = db.prepare(
        `INSERT INTO sections (id, document_id, parent_id, title, level, page_start, page_end, summary, ordinal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const s of result.sections) {
        insSection.run(
          sectionId(documentId, s.index),
          documentId,
          s.parentIndex === null ? null : sectionId(documentId, s.parentIndex),
          s.title,
          s.level,
          s.pageStart,
          s.pageEnd,
          s.summary,
          s.index,
        );
      }

      const insChunk = db.prepare(
        `INSERT INTO chunks (id, document_id, section_id, parent_id, prev_id, next_id, kind, text,
           context_header, page, token_count, quality, ordinal, exception,
           pdf_page_end, printed_page_start, printed_page_end)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insEmb = db.prepare(
        'INSERT INTO embeddings (chunk_id, model, vector) VALUES (?, ?, ?)',
      );
      result.chunks.forEach((c, i) => {
        insChunk.run(
          c.id,
          documentId,
          sectionId(documentId, c.sectionIndex),
          c.parentId,
          c.prevId,
          c.nextId,
          c.kind,
          c.text,
          c.contextHeader,
          c.page,
          c.tokenCount,
          c.quality,
          i,
          c.exception ?? null,
          c.page,
          c.page + result.pageOffset,
          c.page + result.pageOffset,
        );
        const vec = result.embeddings[i];
        if (vec) insEmb.run(c.id, result.embeddingModel, encodeVector(vec));
      });

      // Slides and notes: one lecture unit per section (BRIEF 7: "one lecture_unit per slide"),
      // whose text is that section's chunks. Books produce chunks, not units.
      const kind = (
        db.prepare('SELECT kind FROM documents WHERE id = ?').get(documentId) as { kind: string }
      ).kind;
      if (kind === 'slides' || kind === 'handwritten') {
        const insUnit = db.prepare(
          `INSERT INTO lecture_units (id, document_id, unit_no, title, text, query_text)
           VALUES (?, ?, ?, ?, ?, ?)`,
        );
        let unitNo = 0;
        for (const s of result.sections) {
          const text = result.chunks
            .filter((c) => c.sectionIndex === s.index)
            .map((c) => c.text)
            .join('\n')
            .trim();
          if (text.length === 0) continue;
          unitNo += 1;
          insUnit.run(`unit_${documentId}_${unitNo}`, documentId, unitNo, s.title, text, text);
        }
      }

      const insEx = db.prepare(
        `INSERT INTO exercises (id, document_id, chunk_id, label, statement, has_solution, solution, page,
           printed_page)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const e of result.exercises) {
        insEx.run(
          e.id,
          documentId,
          e.chunkId,
          e.label,
          e.statement,
          e.hasSolution ? 1 : 0,
          e.solution,
          e.page,
          e.page + result.pageOffset,
        );
      }
    })();
  }

  sections(documentId: string): Section[] {
    return (
      this.db
        .prepare('SELECT * FROM sections WHERE document_id = ? ORDER BY ordinal')
        .all(documentId) as SectionRow[]
    ).map((r) => ({
      id: r.id,
      documentId: r.document_id,
      parentId: r.parent_id,
      title: r.title,
      level: r.level,
      pageStart: r.page_start,
      pageEnd: r.page_end,
      summary: r.summary,
    }));
  }

  chunks(documentId: string): Chunk[] {
    return (
      this.db
        .prepare('SELECT * FROM chunks WHERE document_id = ? ORDER BY ordinal')
        .all(documentId) as ChunkRow[]
    ).map((r) => ({
      id: r.id,
      documentId: r.document_id,
      sectionId: r.section_id,
      parentId: r.parent_id,
      prevId: r.prev_id,
      nextId: r.next_id,
      kind: r.kind,
      text: r.text,
      contextHeader: r.context_header,
      page: r.page,
      pdfPageStart: r.page,
      pdfPageEnd: r.pdf_page_end ?? r.page,
      printedPageStart: r.printed_page_start,
      printedPageEnd: r.printed_page_end,
      tokenCount: r.token_count,
      quality: r.quality,
    }));
  }

  exercises(documentId: string): Exercise[] {
    return (
      this.db
        .prepare('SELECT * FROM exercises WHERE document_id = ? ORDER BY page, label')
        .all(documentId) as ExerciseRow[]
    ).map((r) => ({
      id: r.id,
      documentId: r.document_id,
      chunkId: r.chunk_id,
      label: r.label,
      statement: r.statement,
      hasSolution: r.has_solution === 1,
      solution: r.solution,
      page: r.page,
      printedPage: r.printed_page,
      difficulty: r.difficulty,
      level: r.level,
      topicTags: JSON.parse(r.topic_tags) as string[],
      verifiable: r.verifiable === 1,
    }));
  }

  embeddings(documentId: string): Array<{ chunkId: string; model: string; vector: number[] }> {
    const rows = this.db
      .prepare(
        `SELECT e.chunk_id, e.model, e.vector FROM embeddings e
         JOIN chunks c ON c.id = e.chunk_id WHERE c.document_id = ? ORDER BY c.ordinal`,
      )
      .all(documentId) as Array<{ chunk_id: string; model: string; vector: Buffer }>;
    return rows.map((r) => ({
      chunkId: r.chunk_id,
      model: r.model,
      vector: decodeVector(r.vector),
    }));
  }
}
