import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  ChatBody,
  ChatEvent,
  ChatExamplesResponse,
  CourseParams,
  demo,
  type ChatEventPayload,
} from '@gyan/core';
import type { Db } from '../db';
import { badRequest, courseExists, fail, send } from './shared';

/** Simple per-process rate limit for the chat endpoint (BRIEF 17): 20 requests per minute. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

/**
 * STUB (Laptop A for the contract, Laptop B replaces the body with the Study Agent in Phase 2):
 * POST /api/courses/:id/chat replays a canned conversation as SSE using the real event schema.
 * It picks the example whose question best overlaps the message; with no overlap it replays the
 * abstain example. Nothing here is a model answer.
 */
export function registerChatRoutes(app: FastifyInstance, db: Db) {
  const hits: number[] = [];

  const pick = (message: string): ChatEventPayload[] => {
    const words = new Set(message.toLowerCase().match(/[a-z]{4,}/g) ?? []);
    let best = demo.chatExamples.find((e) => e.id === 'chat_abstain') ?? demo.chatExamples[0];
    let bestScore = 0;
    for (const ex of demo.chatExamples) {
      if (ex.id === 'chat_abstain') continue;
      const score = (ex.question.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) =>
        words.has(w),
      ).length;
      if (score > bestScore) {
        best = ex;
        bestScore = score;
      }
    }
    return best?.events ?? [];
  };

  app.get('/api/courses/:id/chat/examples', async (req, reply) => {
    const params = CourseParams.safeParse(req.params);
    if (!params.success) return badRequest(reply, params.error);
    if (!courseExists(db, params.data.id)) {
      return fail(reply, 404, 'course_not_found', `No course with id "${params.data.id}"`);
    }
    return send(reply, ChatExamplesResponse, demo.chatExamples);
  });

  app.post('/api/courses/:id/chat', async (req, reply) => {
    const params = CourseParams.safeParse(req.params);
    const body = ChatBody.safeParse(req.body);
    if (!params.success) return badRequest(reply, params.error);
    if (!body.success) return badRequest(reply, body.error);
    if (!courseExists(db, params.data.id)) {
      return fail(reply, 404, 'course_not_found', `No course with id "${params.data.id}"`);
    }
    const now = Date.now();
    while (hits.length > 0 && now - (hits[0] ?? 0) > WINDOW_MS) hits.shift();
    if (hits.length >= MAX_PER_WINDOW) {
      return fail(reply, 429, 'rate_limited', 'Too many chat requests; wait a minute.');
    }
    hits.push(now);

    const sessionId = body.data.sessionId ?? `sess_${randomUUID()}`;
    db.prepare('INSERT OR IGNORE INTO chat_sessions (id, course_id) VALUES (?, ?)').run(
      sessionId,
      params.data.id,
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
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    for (const event of pick(body.data.message)) {
      // The canned session id is replaced so each request gets its own.
      const out = event.type === 'session' ? { ...event, sessionId } : event;
      const valid = ChatEvent.safeParse(out);
      if (!valid.success) continue;
      res.write(`data: ${JSON.stringify(valid.data)}\n\n`);
    }
    res.end();
  });
}
