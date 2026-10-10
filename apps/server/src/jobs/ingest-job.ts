import { createHash, randomUUID } from 'node:crypto';
import {
  contentHash,
  ingestDocument,
  type EmbeddingProvider,
  type LLMProvider,
  type SourceRole,
} from '@gyan/core';
import type { DocumentRepository } from '../db/repositories/documents';
import type { IngestStore } from '../db/repositories/ingest-store';
import type { JobRunner } from './runner';

export interface IngestDeps {
  documents: DocumentRepository;
  store: IngestStore;
  runner: JobRunner;
  llm: LLMProvider;
  embeddings: EmbeddingProvider;
  renderPage?: (page: number) => Promise<Uint8Array>;
}

export interface IngestRequest {
  courseId: string;
  role: SourceRole;
  title: string;
  bytes: Uint8Array;
  transcript?: string;
}

export interface IngestStarted {
  documentId: string;
  jobId: string;
  /** True when these exact bytes were already ingested into this course: nothing is re-run. */
  cached: boolean;
}

/**
 * Start ingesting a file. The content hash is the cache key: the same bytes in the same course
 * return the existing document and a job that is already 'done', without calling any model.
 */
export function startIngest(deps: IngestDeps, req: IngestRequest): IngestStarted {
  // A corrected transcript must not return stale text from a file-only cache entry.
  const hash =
    req.transcript === undefined
      ? contentHash(req.bytes)
      : createHash('sha256')
          .update('manual-transcript-v1\0')
          .update(contentHash(req.bytes))
          .update('\0')
          .update(req.transcript.trim().replace(/\r\n?/g, '\n'))
          .digest('hex');

  const existing = deps.documents.findByHash(req.courseId, hash);
  if (existing) {
    const jobId = deps.runner.start('ingest', existing.id, async (report) => {
      report(1, 'Already ingested (cached)');
    });
    return { documentId: existing.id, jobId, cached: true };
  }

  const documentId = `doc_${randomUUID()}`;
  deps.documents.createPending({
    id: documentId,
    courseId: req.courseId,
    role: req.role,
    title: req.title,
    contentHash: hash,
  });

  const jobId = deps.runner.start('ingest', documentId, async (report) => {
    try {
      const result = await ingestDocument({
        documentId,
        role: req.role,
        title: req.title,
        bytes: req.bytes,
        transcript: req.transcript,
        llm: deps.llm,
        embeddings: deps.embeddings,
        renderPage: deps.renderPage,
        onProgress: (p) => report(p.progress, p.message),
      });
      deps.store.save(documentId, result);
    } catch (err) {
      // Don't leave a half-made document that would block a retry of the same file.
      deps.documents.delete(documentId);
      throw err;
    }
  });
  return { documentId, jobId, cached: false };
}
