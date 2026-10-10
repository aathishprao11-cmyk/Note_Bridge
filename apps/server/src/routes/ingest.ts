import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { DocumentKindSchema, type DocumentKind, type SourceRole } from '@gyan/core';
import type { JobRepository } from '../db/repositories/jobs';
import { startIngest, type IngestDeps, type ProgressBus } from '../jobs';

/** The upload field is `kind` (Section 5). The pipeline ingests these three; the rest come later. */
const KIND_TO_ROLE: Partial<Record<DocumentKind, SourceRole>> = {
  book: 'book',
  slides: 'slides',
  handwritten: 'notes',
};
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export interface IngestRouteDeps {
  ingest: IngestDeps;
  bus: ProgressBus;
  jobs: JobRepository;
}

function fail(
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  status: number,
  code: string,
  message: string,
) {
  return reply.code(status).send({ error: { code, message } });
}

/**
 * Engine routes for ingestion (provisional ownership, see docs/TEAM.md):
 *   POST /api/courses/:courseId/documents  multipart: role, title, file -> { documentId, jobId, cached }
 *   GET  /api/courses/:courseId/documents  -> Document[]
 *   GET  /api/jobs/:jobId                  -> current job state
 *   GET  /api/jobs/:jobId/events           -> SSE stream of JobProgress
 * Errors use { error: { code, message } } as in docs/API.md.
 */
export async function registerIngestRoutes(app: FastifyInstance, deps: IngestRouteDeps) {
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
  const { documents } = deps.ingest;

  app.post<{ Params: { courseId: string } }>(
    '/api/courses/:courseId/documents',
    async (req, reply) => {
      const { courseId } = req.params;
      if (!documents.courseExists(courseId)) {
        return fail(reply, 404, 'course_not_found', `No course with id "${courseId}"`);
      }
      const fields: Record<string, string> = {};
      let bytes: Uint8Array | null = null;
      let filename = '';
      try {
        for await (const part of req.parts()) {
          if (part.type === 'file') {
            bytes = new Uint8Array(await part.toBuffer());
            filename = part.filename;
          } else if (typeof part.value === 'string') {
            fields[part.fieldname] = part.value;
          }
        }
      } catch (err) {
        const tooBig = (err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE';
        return fail(
          reply,
          tooBig ? 413 : 400,
          tooBig ? 'file_too_large' : 'bad_upload',
          tooBig ? 'File is larger than 100 MB' : 'Could not read the upload',
        );
      }
      if (!bytes || bytes.length === 0)
        return fail(reply, 400, 'no_file', 'Attach a non-empty file');
      const kind = DocumentKindSchema.safeParse(fields.kind);
      if (!kind.success) {
        return fail(
          reply,
          400,
          'bad_kind',
          'kind must be one of: book, slides, handwritten, past_paper, syllabus, text_note',
        );
      }
      const role = KIND_TO_ROLE[kind.data];
      if (!role) {
        return fail(
          reply,
          422,
          'kind_not_supported_yet',
          `Uploading "${kind.data}" is not supported yet; use book, slides or handwritten.`,
        );
      }
      const title = (fields.title ?? '').trim() || filename.replace(/\.[^.]+$/, '') || 'Untitled';
      const started = startIngest(deps.ingest, { courseId, role, title, bytes });
      return reply.code(202).send(started);
    },
  );

  app.get<{ Params: { courseId: string } }>(
    '/api/courses/:courseId/documents',
    async (req, reply) => {
      if (!documents.courseExists(req.params.courseId)) {
        return fail(reply, 404, 'course_not_found', `No course with id "${req.params.courseId}"`);
      }
      return documents.listByCourse(req.params.courseId);
    },
  );

  app.get<{ Params: { jobId: string } }>('/api/jobs/:jobId', async (req, reply) => {
    const job = deps.jobs.get(req.params.jobId);
    if (!job) return fail(reply, 404, 'job_not_found', `No job with id "${req.params.jobId}"`);
    return job;
  });

  app.get<{ Params: { jobId: string } }>('/api/jobs/:jobId/events', async (req, reply) => {
    const { jobId } = req.params;
    const known = deps.jobs.get(jobId);
    if (!known) return fail(reply, 404, 'job_not_found', `No job with id "${jobId}"`);

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    let closed = false;
    // Declared before subscribing: subscribe() replays the last event synchronously, and for a
    // job that already finished that calls end() before subscribe() has returned.
    let unsubscribe: () => void = () => undefined;
    const end = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      res.end();
    };
    const send = (p: { status: string }) => {
      if (closed) return;
      res.write(`data: ${JSON.stringify(p)}\n\n`);
      if (p.status === 'done' || p.status === 'failed') end();
    };
    // Jobs that finished before a restart are not on the bus; replay their stored state.
    unsubscribe = deps.bus.subscribe(jobId, send);
    if (closed) unsubscribe();
    else if (!deps.bus.latest(jobId)) send(known);
    req.raw.on('close', end);
  });
}
