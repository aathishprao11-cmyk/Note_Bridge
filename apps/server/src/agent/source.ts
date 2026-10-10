import type { SourceRole } from '@gyan/core';
import type { Db } from '../db';
import { rankHits } from './corpus';

/** One retrieved piece of a course document, with the page numbers a citation needs. */
export interface PageHit {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  role: SourceRole;
  /** PDF page. */
  page: number;
  /** Page printed on the paper (what the UI shows). */
  printedPage: number;
  text: string;
  /** 0..1 share of query words found. */
  score: number;
}

export interface ChunkSource {
  courseExists(courseId: string): boolean;
  search(courseId: string, query: string, topK: number): Promise<PageHit[]>;
}

interface ChunkRow {
  chunk_id: string;
  document_id: string;
  title: string;
  role: SourceRole;
  page: number;
  printed_page: number;
  text: string;
}

/**
 * Reads the ingested chunks (what `pnpm seed` and the ingestion pipeline write). Page numbers come
 * from the database, never from a model. Garbled low-quality chunks are never retrieved.
 */
export class DbChunkSource implements ChunkSource {
  constructor(private readonly db: Db) {}

  courseExists(courseId: string): boolean {
    return this.db.prepare('SELECT 1 FROM courses WHERE id = ?').get(courseId) !== undefined;
  }

  async search(courseId: string, query: string, topK: number): Promise<PageHit[]> {
    const rows = this.db
      .prepare(
        `SELECT c.id AS chunk_id, c.document_id, d.title, d.role, c.page,
                COALESCE(c.printed_page_start, c.page + d.page_offset) AS printed_page, c.text
           FROM chunks c JOIN documents d ON d.id = c.document_id
          WHERE d.course_id = ? AND c.quality >= 0.3`,
      )
      .all(courseId) as ChunkRow[];
    return rankHits(
      rows.map((r) => ({
        chunkId: r.chunk_id,
        documentId: r.document_id,
        documentTitle: r.title,
        role: r.role,
        page: r.page,
        printedPage: r.printed_page,
        text: r.text,
      })),
      query,
      topK,
    );
  }
}

export function createChunkSource(db: Db): ChunkSource {
  return new DbChunkSource(db);
}
