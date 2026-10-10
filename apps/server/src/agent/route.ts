import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ChatBody, ChatEvent, CourseParams, type ChatEventPayload } from '@gyan/core';
import type { Db } from '../db';
import { badRequest, courseExists, fail } from '../routes/shared';
import { runChat, type PipelineOptions } from './pipeline';
import type { ChunkSource } from './source';
import type { Agent, ChatMessageIn } from './types';

export interface StudyChatDeps extends PipelineOptions {
  agent: Agent;
  source: ChunkSource;
}

/** Per-process rate limit for the chat endpoint (BRIEF 17): 20 requests per minute. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const MAX_HISTORY = 20;

function priorTurns(db: Db, sessionId: string): ChatMessageIn[] {
  const rows = db
    .prepare(
      'SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at, rowid',
    )
    .all(sessionId) as ChatMessageIn[];
  return rows.slice(-MAX_HISTORY);
}

/**
 * POST /api/courses/:id/chat  body { message, sessionId? }  (the frozen contract: `ChatBody`).
 * Answers with server-sent events, each a `data: <ChatEvent json>` frame: `session`, then the
 * agent's `tool-started` / `tool-finished` / `text` / `usage`, then `done` (validated) or `error`.
 * Every frame is checked against the contract's `ChatEvent` schema before it is written.
 * Bad input and unknown courses are plain JSON errors sent before the stream opens.
 */
export async function registerStudyChatRoute(app: FastifyInstance, db: Db, deps: StudyChatDeps) {
  const hits: number[] = [];

  app.post('/api/courses/:id/chat', async (req, reply) => {
    const params = CourseParams.safeParse(req.params);
    const body = ChatBody.safeParse(req.body);
    if (!params.success) return badRequest(reply, params.error);
    if (!body.success) return badRequest(reply, body.error);
    const courseId = params.data.id;
    if (!courseExists(db, courseId)) {
      return fail(reply, 404, 'course_not_found', `No course with id "${courseId}"`);
    }
    const now = Date.now();
    while (hits.length > 0 && now - (hits[0] ?? 0) > WINDOW_MS) hits.shift();
    if (hits.length >= MAX_PER_WINDOW) {
      return fail(reply, 429, 'rate_limited', 'Too many chat requests; wait a minute.');
    }
    hits.push(now);

    const sessionId = body.data.sessionId ?? `sess_${randomUUID()}`;
    const existing = db
      .prepare('SELECT course_id FROM chat_sessions WHERE id = ?')
      .get(sessionId) as { course_id: string } | undefined;
    if (existing && existing.course_id !== courseId) {
      return fail(reply, 400, 'bad_request', 'sessionId belongs to a different course');
    }
    const history = existing ? priorTurns(db, sessionId) : [];
    db.prepare('INSERT OR IGNORE INTO chat_sessions (id, course_id) VALUES (?, ?)').run(
      sessionId,
      courseId,
    );
    db.prepare('INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').run(
      `msg_${randomUUID()}`,
      sessionId,
      'user',
      body.data.message,
    );

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      // hijack() bypasses the CORS plugin, so the header is set here (as the job stream does).
      'Access-Control-Allow-Origin': '*',
    });
    let closed = false;
    res.on('close', () => {
      closed = true;
    });
    const write = (event: ChatEventPayload) => {
      const valid = ChatEvent.safeParse(event);
      const out: ChatEventPayload = valid.success
        ? valid.data
        : {
            type: 'error',
            code: 'contract_violation',
            message: 'The server built an invalid event.',
          };
      res.write(`data: ${JSON.stringify(out)}\n\n`);
    };

    const tools: Array<{ name: string; input: Record<string, unknown>; summary: string }> = [];
    const events = runChat(
      deps.agent,
      deps.source,
      { courseId, message: body.data.message, history },
      deps,
    );
    try {
      write({ type: 'session', sessionId });
      for await (const event of events) {
        if (closed) break; // the client went away: stop the agent
        if (event.type === 'tool-finished') tools.push(event.call);
        write(event);
        if (event.type === 'done') {
          db.prepare(
            `INSERT INTO chat_messages (id, session_id, role, content, tool_calls_json,
               citations_json, unverified_calculation, confidence)
             VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)`,
          ).run(
            event.messageId,
            sessionId,
            event.content,
            JSON.stringify(tools),
            JSON.stringify(event.citations),
            event.unverifiedCalculation ? 1 : 0,
            event.confidence,
          );
        }
      }
    } finally {
      await events.return(undefined);
      if (!res.writableEnded) res.end();
    }
  });
}
