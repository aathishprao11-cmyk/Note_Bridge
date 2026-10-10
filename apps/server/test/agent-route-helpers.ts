import type { AddressInfo } from 'node:net';
import { expect } from 'vitest';
import { ChatEvent, type ChatEventPayload } from '@gyan/core';
import { MockAgent } from '../src/agent';
import { COURSE, seededApp } from './agent-helpers';

export { COURSE };
export type Built = Awaited<ReturnType<typeof seededApp>>;

/** Parse an SSE body into events, validating every frame against the frozen contract schema. */
export function parseFrames(body: string): ChatEventPayload[] {
  return body
    .trim()
    .split('\n\n')
    .map((frame) => {
      expect(frame.startsWith('data: ')).toBe(true);
      const parsed = ChatEvent.safeParse(JSON.parse(frame.slice(6)));
      expect(parsed.success).toBe(true);
      return parsed.data as ChatEventPayload;
    });
}

/** Run `fn` against a real listening server with the demo course seeded. */
export async function withServer<T>(
  fn: (base: string, built: Built) => Promise<T>,
  agent = new MockAgent(),
): Promise<T> {
  const built = await seededApp(agent);
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = built.app.server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`, built);
  } finally {
    await built.app.close();
  }
}

export const post = (base: string, body: unknown, course: string = COURSE) =>
  fetch(`${base}/api/courses/${course}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

export const doneOf = (events: ChatEventPayload[]) =>
  events.find((e): e is Extract<ChatEventPayload, { type: 'done' }> => e.type === 'done');
