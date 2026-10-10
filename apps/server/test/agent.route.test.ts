import { describe, expect, it } from 'vitest';
import type { ChatEventPayload } from '@gyan/core';
import { MockAgent } from '../src/agent';
import { doneOf, parseFrames, post, withServer } from './agent-route-helpers';

describe('POST /api/courses/:id/chat (Study Agent)', () => {
  it('streams contract-valid frames: session first, done last, with verified citations', async () => {
    await withServer(async (base) => {
      const res = await post(base, { message: 'What is acceleration?' });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const events = parseFrames(await res.text());
      expect(events[0]?.type).toBe('session');
      expect(events.at(-1)?.type).toBe('done');
      expect(events.some((e) => e.type === 'tool-started')).toBe(true);
      expect(events.some((e) => e.type === 'tool-finished')).toBe(true);
      const done = doneOf(events)!;
      expect(done.citations.length).toBeGreaterThan(0);
      expect(done.citations.every((c) => c.status === 'verified')).toBe(true);
    });
  });

  it('delivers frames incrementally, not as one buffered blob', async () => {
    await withServer(
      async (base) => {
        const res = await post(base, { message: 'What is acceleration?' });
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

  it('abstains on an unanswerable question instead of guessing', async () => {
    await withServer(async (base) => {
      const res = await post(base, {
        message: 'What does my textbook say about quantum tunnelling?',
      });
      const done = doneOf(parseFrames(await res.text()))!;
      expect(done).toMatchObject({ abstained: true, citations: [], confidence: null });
    });
  });

  it('stores the session and both messages, with tool calls and citations on the answer', async () => {
    await withServer(async (base, { db }) => {
      const res = await post(base, { message: 'What is acceleration?' });
      const events = parseFrames(await res.text());
      const session = events[0] as Extract<ChatEventPayload, { type: 'session' }>;
      const rows = db
        .prepare(
          `SELECT role, content, tool_calls_json, citations_json FROM chat_messages
            WHERE session_id = ? ORDER BY rowid`,
        )
        .all(session.sessionId) as Array<Record<string, string>>;
      expect(rows.map((r) => r.role)).toEqual(['user', 'assistant']);
      expect(rows[0]?.content).toBe('What is acceleration?');
      expect(JSON.parse(rows[1]?.tool_calls_json ?? '[]')).toHaveLength(1);
      expect(JSON.parse(rows[1]?.citations_json ?? '[]').length).toBeGreaterThan(0);
    });
  });

  it('reuses a session id and refuses one that belongs to another course', async () => {
    await withServer(async (base, { db }) => {
      const first = parseFrames(await (await post(base, { message: 'What is velocity?' })).text());
      const sessionId = (first[0] as Extract<ChatEventPayload, { type: 'session' }>).sessionId;
      const again = parseFrames(
        await (await post(base, { message: 'And acceleration?', sessionId })).text(),
      );
      expect(again[0]).toEqual({ type: 'session', sessionId });
      const count = db
        .prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE session_id = ?')
        .get(sessionId) as { n: number };
      expect(count.n).toBe(4);

      db.prepare("INSERT INTO courses (id, name) VALUES ('other', 'Other')").run();
      const res = await post(base, { message: 'hello there', sessionId }, 'other');
      expect(res.status).toBe(400);
    });
  });

  it('an invented citation never reaches the client over HTTP', async () => {
    const agent = new MockAgent({
      extraCitations: [
        {
          documentId: 'doc_book',
          chunkId: 'made-up',
          page: 77,
          printedPage: 74,
          quote: 'Not in any tool result.',
        },
      ],
    });
    await withServer(async (base) => {
      const res = await post(base, { message: 'What is acceleration?' });
      const done = doneOf(parseFrames(await res.text()))!;
      expect(done.citations.some((c) => c.chunkId === 'made-up')).toBe(false);
      expect(done.content).not.toMatch(/\[4\]/);
    }, agent);
  });
});
