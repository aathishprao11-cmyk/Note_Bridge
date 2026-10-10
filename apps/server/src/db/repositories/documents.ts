import type { Document, DocumentKind, DocumentLevel, DocumentStatus, SourceRole } from '@gyan/core';
import type { Db } from '../index';

interface DocumentRow {
  id: string;
  course_id: string;
  role: SourceRole;
  kind: DocumentKind;
  title: string;
  path: string | null;
  level: DocumentLevel;
  meta_json: string;
  status: DocumentStatus;
  extraction_quality: number | null;
  content_hash: string;
  page_count: number;
  page_offset: number;
  created_at: string;
}

function toDocument(r: DocumentRow): Document {
  return {
    id: r.id,
    courseId: r.course_id,
    kind: r.kind,
    title: r.title,
    path: r.path,
    level: r.level,
    meta: JSON.parse(r.meta_json) as Record<string, unknown>,
    status: r.status,
    extractionQuality: r.extraction_quality,
    contentHash: r.content_hash,
    pageCount: r.page_count,
    pageOffset: r.page_offset,
    createdAt: r.created_at,
  };
}

export class DocumentRepository {
  constructor(private readonly db: Db) {}

  ensureCourse(id: string, name: string): void {
    this.db.prepare('INSERT OR IGNORE INTO courses (id, name) VALUES (?, ?)').run(id, name);
  }

  courseExists(id: string): boolean {
    return this.db.prepare('SELECT 1 FROM courses WHERE id = ?').get(id) !== undefined;
  }

  /** The ingestion cache: a file already ingested into this course (same bytes). */
  findByHash(courseId: string, contentHash: string): Document | null {
    const row = this.db
      .prepare(
        "SELECT * FROM documents WHERE course_id = ? AND content_hash = ? AND status = 'ready'",
      )
      .get(courseId, contentHash) as DocumentRow | undefined;
    return row ? toDocument(row) : null;
  }

  get(id: string): Document | null {
    const row = this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as
      DocumentRow | undefined;
    return row ? toDocument(row) : null;
  }

  listByCourse(courseId: string): Document[] {
    return (
      this.db
        .prepare('SELECT * FROM documents WHERE course_id = ? ORDER BY created_at, id')
        .all(courseId) as DocumentRow[]
    ).map(toDocument);
  }

  /** Warnings recorded when the document was ingested (garbled pages, missing offsets, ...). */
  warnings(id: string): string[] {
    const row = this.db.prepare('SELECT warnings FROM documents WHERE id = ?').get(id) as
      { warnings: string } | undefined;
    return row ? (JSON.parse(row.warnings) as string[]) : [];
  }

  /** Create the row up front (status 'processing') so a job can point at it. */
  createPending(args: {
    id: string;
    courseId: string;
    role: SourceRole;
    title: string;
    contentHash: string;
  }): void {
    this.db
      .prepare(
        "INSERT INTO documents (id, course_id, role, kind, title, content_hash, status) VALUES (?, ?, ?, ?, ?, ?, 'processing')",
      )
      .run(
        args.id,
        args.courseId,
        args.role,
        args.role === 'notes' ? 'handwritten' : args.role,
        args.title,
        args.contentHash,
      );
  }

  markFailed(id: string): void {
    this.db.prepare("UPDATE documents SET status = 'failed' WHERE id = ?").run(id);
  }

  /** Remove a document and everything under it (sections, chunks, embeddings, exercises). */
  delete(id: string): void {
    this.db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  }
}
