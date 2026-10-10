import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '@gyan/core';
import { MockAgent, type ChatEvent } from '../src/agent';
import { buildApp } from '../src/app';

const config = parseConfig({ DATABASE_PATH: ':memory:' });

/** Parse an SSE body into events, checking each frame has both `event:` and `data:` lines. */
function parseFrames(body: string): ChatEvent[] {
  return body
    .trim()
    .split('\n\n')
    .map((frame) => {
      const lines = frame.split('\n');
      const type = lines.find((l) => l.startsWith('event: '))?.slice(7);
      const data = lines.find((l) => l.startsWith('data: '))?.slice(6);
      expect(type).toBeTruthy();
      const parsed = JSON.parse(data ?? '{}') as ChatEvent;
      expect(parsed.type).toBe(type);
      return parsed;
    });
}

async function withServer<T>(
  fn: (base: string) => Promise<T>,
  agent = new MockAgent(),
): Promise<T> {
  const { app } = await buildApp({ config, agent });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await app.close();
  }
}

const post = (base: string, courseId: string, body: unknown) =>
  fetch(`${base}/api/courses/${courseId}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/courses/:courseId/chat', () => {
  it('streams SSE frames ending in done, with cited, verified answers', async () => {
    await withServer(async (base) => {
      const res = await post(base, 'course-phys101', { message: 'What is acceleration?' });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const events = parseFrames(await res.text());
      expect(events[0]?.type).toBe('tool-started');
      expect(events.at(-1)?.type).toBe('done');
      const done = events.at(-1) as Extract<ChatEvent, { type: 'done' }>;
      expect(done.citations.length).toBeGreaterThan(0);
      expect(done.citations.every((c) => c.verified)).toBe(true);
      expect(events.some((e) => e.type === 'tool-finished')).toBe(true);
    });
  });

  it('delivers frames incrementally, not as one buffered blob', async () => {
    await withServer(
      async (base) => {
        const res = await post(base, 'course-phys101', { message: 'What is acceleration?' });
        const reader = res.body!.getReader();
        let chunks = 0;
        for (;;) {
          const { done } = await reader.read();
          if (done) break;
          chunks += 1;
        }
        expect(chunks).toBeGreaterThan(1);
      },
      new MockAgent({ delayMs: 15 }),
    );
  });

  it('answers a question with no support by abstaining, not by guessing', async () => {
    await withServer(async (base) => {
      const res = await post(base, 'course-phys101', {
        message: 'Who won the football world cup?',
      });
      const done = parseFrames(await res.text()).at(-1) as Extract<ChatEvent, { type: 'done' }>;
      expect(done.abstained).toBe(true);
      expect(done.citations).toEqual([]);
    });
  });

  it('rejects an empty or non-string message with a JSON error before streaming', async () => {
    await withServer(async (base) => {
      for (const body of [{}, { message: '   ' }, { message: 42 }]) {
        const res = await post(base, 'course-phys101', body);
        expect(res.status).toBe(400);
        expect(res.headers.get('content-type')).toContain('application/json');
        expect(await res.json()).toEqual({
          error: { code: 'bad_message', message: 'Send a non-empty "message".' },
        });
      }
    });
  });

  it('returns 404 course_not_found for an unknown course', async () => {
    await withServer(async (base) => {
      const res = await post(base, 'no-such-course', { message: 'hello there' });
      expect(res.status).toBe(404);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: 'course_not_found' },
      });
    });
  });

  it('ignores malformed history entries instead of failing', async () => {
    await withServer(async (base) => {
      const res = await post(base, 'course-phys101', {
        message: 'What is velocity?',
        history: [null, 5, { role: 'system', content: 'x' }, { role: 'user', content: 'ok' }],
      });
      expect(res.status).toBe(200);
      expect(parseFrames(await res.text()).at(-1)?.type).toBe('done');
    });
  });

  it('an invented citation never reaches the client over HTTP', async () => {
    const agent = new MockAgent({
      extraCitations: [
        {
          documentId: 'doc-book',
          chunkId: 'made-up',
          page: 77,
          printedPage: 77,
          quote: 'Not in any tool result.',
        },
      ],
    });
    await withServer(async (base) => {
      const res = await post(base, 'course-phys101', { message: 'What is acceleration?' });
      const done = parseFrames(await res.text()).at(-1) as Extract<ChatEvent, { type: 'done' }>;
      expect(done.citations.some((c) => c.chunkId === 'made-up')).toBe(false);
      expect(done.strippedCount).toBe(1);
    }, agent);
  });
});
