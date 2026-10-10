import { describe, expect, it } from 'vitest';
import { samplePdf } from './ingest-helpers';
import { appWithCourse, multipart } from './multipart-helpers';

interface Event {
  status: string;
  progress: number;
}

const parseSse = (body: string): Event[] =>
  body
    .split('\n\n')
    .filter((b) => b.startsWith('data: '))
    .map((b) => JSON.parse(b.slice(6)) as Event);

describe('ingest routes: jobs and SSE', () => {
  it('returns 404 for an unknown job and for events of an unknown job', async () => {
    const { app } = await appWithCourse();
    expect((await app.inject({ method: 'GET', url: '/api/jobs/job_x' })).statusCode).toBe(404);
    const events = await app.inject({ method: 'GET', url: '/api/jobs/job_x/events' });
    expect(events.statusCode).toBe(404);
    expect(events.json().error.code).toBe('job_not_found');
    await app.close();
  });

  it('streams progress as server-sent events and ends on done', async () => {
    const { app } = await appWithCourse();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const up = await app.inject({
      method: 'POST',
      url: '/api/courses/course1/documents',
      ...multipart({ kind: 'book' }, { name: 'book.pdf', bytes: await samplePdf() }),
    });
    const res = await fetch(`http://127.0.0.1:${port}/api/jobs/${up.json().jobId}/events`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = parseSse(await res.text()); // the server ends the stream after done/failed

    expect(events.length).toBeGreaterThan(1);
    expect(events[events.length - 1]).toMatchObject({ status: 'done', progress: 1 });
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.progress).toBeGreaterThanOrEqual(events[i - 1]!.progress);
    }
    await app.close();
  });

  it('replays the final state to a client that connects after the job finished', async () => {
    const { app, runner } = await appWithCourse();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const up = await app.inject({
      method: 'POST',
      url: '/api/courses/course1/documents',
      ...multipart({ kind: 'book' }, { name: 'book.pdf', bytes: await samplePdf() }),
    });
    await runner.idle();
    const res = await fetch(`http://127.0.0.1:${port}/api/jobs/${up.json().jobId}/events`);
    const events = parseSse(await res.text());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: 'done', progress: 1 });
    await app.close();
  });

  it('streams a failed job as a final failed event', async () => {
    const { app } = await appWithCourse();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const up = await app.inject({
      method: 'POST',
      url: '/api/courses/course1/documents',
      ...multipart({ kind: 'book' }, { name: 'bad.pdf', bytes: new Uint8Array([1, 2, 3, 4]) }),
    });
    const res = await fetch(`http://127.0.0.1:${port}/api/jobs/${up.json().jobId}/events`);
    const events = parseSse(await res.text());
    expect(events[events.length - 1]!.status).toBe('failed');
    await app.close();
  });
});
