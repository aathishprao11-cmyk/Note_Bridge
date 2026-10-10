import { describe, expect, it } from 'vitest';
import { samplePdf } from './ingest-helpers';
import { appWithCourse, multipart } from './multipart-helpers';

describe('ingest routes: upload', () => {
  it('uploads a PDF, runs the job and lists the document', async () => {
    const { app, runner } = await appWithCourse();
    const up = await app.inject({
      method: 'POST',
      url: '/api/courses/course1/documents',
      ...multipart(
        { role: 'book', title: 'Physics Book' },
        { name: 'book.pdf', bytes: await samplePdf() },
      ),
    });
    expect(up.statusCode).toBe(202);
    const { documentId, jobId, cached } = up.json();
    expect(cached).toBe(false);
    await runner.idle();

    const job = await app.inject({ method: 'GET', url: `/api/jobs/${jobId}` });
    expect(job.json()).toMatchObject({ status: 'done', progress: 1, documentId });

    const list = await app.inject({ method: 'GET', url: '/api/courses/course1/documents' });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0]).toMatchObject({
      id: documentId,
      title: 'Physics Book',
      kind: 'book',
      pageCount: 2,
    });
    await app.close();
  });

  it('answers a repeat upload from the cache', async () => {
    const { app, runner } = await appWithCourse();
    const bytes = await samplePdf();
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/api/courses/course1/documents',
        ...multipart({ role: 'book' }, { name: 'book.pdf', bytes }),
      });
    const first = (await send()).json();
    await runner.idle();
    const second = (await send()).json();
    expect(second.cached).toBe(true);
    expect(second.documentId).toBe(first.documentId);
    await app.close();
  });

  it('defaults the title to the file name', async () => {
    const { app, runner } = await appWithCourse();
    await app.inject({
      method: 'POST',
      url: '/api/courses/course1/documents',
      ...multipart({ role: 'slides' }, { name: 'lecture-1.pdf', bytes: await samplePdf() }),
    });
    await runner.idle();
    const list = await app.inject({ method: 'GET', url: '/api/courses/course1/documents' });
    expect(list.json()[0].title).toBe('lecture-1');
    await app.close();
  });

  it.each([
    [
      'unknown course',
      '/api/courses/nope/documents',
      { role: 'book' },
      true,
      404,
      'course_not_found',
    ],
    ['missing file', '/api/courses/course1/documents', { role: 'book' }, false, 400, 'no_file'],
    ['bad role', '/api/courses/course1/documents', { role: 'poster' }, true, 400, 'bad_role'],
    ['missing role', '/api/courses/course1/documents', {}, true, 400, 'bad_role'],
  ])('rejects %s with a typed error', async (_name, url, fields, withFile, status, code) => {
    const { app } = await appWithCourse();
    const file = withFile ? { name: 'a.pdf', bytes: new Uint8Array([1, 2, 3]) } : undefined;
    const res = await app.inject({ method: 'POST', url, ...multipart(fields, file) });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error: { code, message: expect.any(String) } });
    await app.close();
  });

  it('reports a failed job for a file that is not a PDF', async () => {
    const { app, runner } = await appWithCourse();
    const up = await app.inject({
      method: 'POST',
      url: '/api/courses/course1/documents',
      ...multipart({ role: 'book' }, { name: 'bad.pdf', bytes: new Uint8Array([1, 2, 3, 4]) }),
    });
    await runner.idle();
    const job = await app.inject({ method: 'GET', url: `/api/jobs/${up.json().jobId}` });
    expect(job.json().status).toBe('failed');
    expect(job.json().error).toMatch(/Could not open PDF/);
    await app.close();
  });
});
