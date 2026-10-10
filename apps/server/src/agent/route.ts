import type { FastifyInstance } from 'fastify';
import { runChat, type PipelineOptions } from './pipeline';
import type { ChunkSource } from './source';
import type { Agent, ChatMessageIn } from './types';

export interface ChatRouteDeps extends PipelineOptions {
  agent: Agent;
  source: ChunkSource;
}

const MAX_MESSAGE_CHARS = 4000;
const MAX_HISTORY = 20;

function fail(
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  status: number,
  code: string,
  message: string,
) {
  return reply.code(status).send({ error: { code, message } });
}

function cleanHistory(value: unknown): ChatMessageIn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (m): m is ChatMessageIn =>
        !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
    )
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
}

/**
 * POST /api/courses/:courseId/chat   body { message, history? }
 * Server-sent events: text, tool-started, tool-finished, usage, done, error (docs/API.md).
 * Each frame is `event: <type>` + `data: <json>`; the JSON also carries `type`. Validation errors
 * (bad message, unknown course) are plain JSON errors with a status, sent before the stream opens.
 */
export async function registerChatRoutes(app: FastifyInstance, deps: ChatRouteDeps) {
  app.post<{ Params: { courseId: string }; Body: { message?: unknown; history?: unknown } }>(
    '/api/courses/:courseId/chat',
    async (req, reply) => {
      const { courseId } = req.params;
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      if (!message) return fail(reply, 400, 'bad_message', 'Send a non-empty "message".');
      if (message.length > MAX_MESSAGE_CHARS) {
        return fail(
          reply,
          400,
          'bad_message',
          `Message is longer than ${MAX_MESSAGE_CHARS} characters.`,
        );
      }
      if (!deps.source.courseExists(courseId)) {
        return fail(reply, 404, 'course_not_found', `No course with id "${courseId}"`);
      }

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

      const events = runChat(
        deps.agent,
        deps.source,
        { courseId, message, history: cleanHistory(req.body?.history) },
        deps,
      );
      try {
        for await (const event of events) {
          if (closed) break; // client went away: stop the agent
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        }
      } finally {
        await events.return(undefined);
        if (!res.writableEnded) res.end();
      }
    },
  );
}
