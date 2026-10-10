import type { SourceRole } from '@gyan/core';
import type { Db } from '../db';
import { DEMO_CHUNKS, DEMO_COURSE_ID, rankHits } from './corpus';

/** One retrieved piece of a course document, with the page numbers a citation needs. */
export interface PageHit {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  role: SourceRole;
  /** PDF page index. */
  page: number;
  /** Page printed on the paper: page + the document's pageOffset. */
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
  page_offset: number;
  text: string;
}

/** Reads ingested chunks (Phase 1a tables). Low-quality (garbled) chunks are never retrieved. */
export class DbChunkSource implements ChunkSource {
  constructor(private readonly db: Db) {}

  courseExists(courseId: string): boolean {
    return this.db.prepare('SELECT 1 FROM courses WHERE id = ?').get(courseId) !== undefined;
  }

  hasChunks(courseId: string): boolean {
    return (
      this.db
        .prepare(
          'SELECT 1 FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.course_id = ? LIMIT 1',
        )
        .get(courseId) !== undefined
    );
  }

  async search(courseId: string, query: string, topK: number): Promise<PageHit[]> {
    const rows = this.db
      .prepare(
        `SELECT c.id AS chunk_id, c.document_id, d.title, d.role, c.page, d.page_offset, c.text
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
        printedPage: r.page + r.page_offset,
        text: r.text,
      })),
      query,
      topK,
    );
  }
}

/**
 * The database first. The built-in demo corpus answers only for the demo course, and only while
 * that course has no ingested chunks, so real uploads always win over the demo text.
 */
export function createChunkSource(db: Db): ChunkSource {
  const real = new DbChunkSource(db);
  return {
    courseExists: (id) => real.courseExists(id) || id === DEMO_COURSE_ID,
    search: async (courseId, query, topK) => {
      if (real.hasChunks(courseId)) return real.search(courseId, query, topK);
      if (courseId === DEMO_COURSE_ID) return rankHits(DEMO_CHUNKS, query, topK);
      return [];
    },
  };
}
