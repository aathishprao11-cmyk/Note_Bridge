import { describe, expect, it } from 'vitest';
import { samplePdf } from './ingest-helpers';
import { appWithCourse, multipart } from './multipart-helpers';

/** Minimal 1x1 PNG: enough for the byte sniffing; no OCR runs in manual-transcript mode. */
const PNG_1PX = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const upload = (
  app: Awaited<ReturnType<typeof appWithCourse>>['app'],
  fields: Record<string, string>,
  file?: { name: string; bytes: Uint8Array },
) =>
  app.inject({ method: 'POST', url: '/api/courses/course1/documents', ...multipart(fields, file) });

describe('handwritten notes: manual transcript (offline)', () => {
  it('refuses a handwritten upload with no transcript while OCR is offline', async () => {
    const { app } = await appWithCourse();
    const res = await upload(app, { kind: 'handwritten' }, { name: 'notes.png', bytes: PNG_1PX });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'transcript_required' } });
    await app.close();
  });

  it('indexes a two-page PDF from a transcript split by ---PAGE--- and stores the page text', async () => {
    const { app, runner } = await appWithCourse();
    const transcript =
      'Force equals mass times acceleration. Newton second law chapter summary. ' +
      'Velocity changes when a net force acts on the object.\n\n---PAGE---\n\n' +
      'Worked example: a two kilogram block accelerates at three metres per second squared.';
    const up = await upload(
      app,
      { kind: 'handwritten', transcript, title: 'My notes' },
      { name: 'notes.pdf', bytes: await samplePdf() },
    );
    expect(up.statusCode).toBe(202);
    await runner.idle();

    const job = await app.inject({ method: 'GET', url: `/api/jobs/${up.json().jobId}` });
    expect(job.json()).toMatchObject({ status: 'done', progress: 1 });

    const docs = await app.inject({ method: 'GET', url: '/api/courses/course1/documents' });
    const doc = (docs.json() as Array<{ id: string; meta: Record<string, unknown> }>)[0]!;
    expect(doc.meta.transcriptionSource).toBe('manual');

    // The page endpoint returns the transcript text (the upload view could show it later).
    const page = await app.inject({ method: 'GET', url: `/api/documents/${doc.id}/pages/1` });
    expect(page.statusCode).toBe(200);
    expect(page.json().page.text).toContain('Newton second law');

    // And the chat agent finds the transcript content.
    const chat = await app.inject({
      method: 'POST',
      url: '/api/courses/course1/chat',
      payload: { message: 'Newton second law chapter summary' },
    });
    const done = chat.body
      .trim()
      .split('\n\n')
      .map((f) => JSON.parse(f.replace(/^data: /, '')) as { type: string; citations?: unknown[] })
      .at(-1)!;
    expect(done.type).toBe('done');
    expect((done as { citations: unknown[] }).citations.length).toBeGreaterThan(0);
    await app.close();
  });

  it('rejects a transcript whose page blocks do not match the file page count', async () => {
    const { app, runner } = await appWithCourse();
    const up = await upload(
      app,
      { kind: 'handwritten', transcript: 'Only one block for a two-page file.' },
      { name: 'notes.pdf', bytes: await samplePdf() },
    );
    expect(up.statusCode).toBe(202);
    await runner.idle();
    const job = await app.inject({ method: 'GET', url: `/api/jobs/${up.json().jobId}` });
    expect(job.json()).toMatchObject({ status: 'failed' });
    expect(job.json().error).toMatch(/2 page\(s\).*1 block/s);
    await app.close();
  });

  it('accepts an image with a one-block transcript (no vision call)', async () => {
    const { app, runner } = await appWithCourse();
    const up = await upload(
      app,
      { kind: 'handwritten', transcript: 'Photosynthesis converts light into chemical energy.' },
      { name: 'bio.png', bytes: PNG_1PX },
    );
    expect(up.statusCode).toBe(202);
    await runner.idle();
    const job = await app.inject({ method: 'GET', url: `/api/jobs/${up.json().jobId}` });
    expect(job.json()).toMatchObject({ status: 'done' });
    await app.close();
  });

  it('refuses a transcript on non-handwritten kinds', async () => {
    const { app } = await appWithCourse();
    const res = await upload(
      app,
      { kind: 'book', transcript: 'nope' },
      { name: 'book.pdf', bytes: await samplePdf() },
    );
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'bad_upload' } });
    await app.close();
  });
});
