import { describe, expect, it } from 'vitest';
import { parseSseBuffer } from '../src/lib/chatStream';
import type { ChatEvent } from '../src/lib/chatTypes';

const frame = (e: ChatEvent) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;

describe('parseSseBuffer', () => {
  it('parses complete frames and keeps the incomplete tail', () => {
    const a = frame({ type: 'text', delta: 'Hel' });
    const b = frame({ type: 'text', delta: 'lo' });
    const { events, rest } = parseSseBuffer(a + b.slice(0, 20));
    expect(events).toEqual([{ type: 'text', delta: 'Hel' }]);
    expect(rest).toBe(b.slice(0, 20));
    const next = parseSseBuffer(rest + b.slice(20));
    expect(next.events).toEqual([{ type: 'text', delta: 'lo' }]);
    expect(next.rest).toBe('');
  });

  it('handles CRLF line endings', () => {
    const raw = frame({ type: 'usage', inputTokens: 5, outputTokens: 2 }).replace(/\n/g, '\r\n');
    expect(parseSseBuffer(raw).events).toEqual([
      { type: 'usage', inputTokens: 5, outputTokens: 2 },
    ]);
  });

  it('ignores comments and keep-alive frames, and skips a malformed frame', () => {
    const raw = `: keep-alive\n\ndata: {not json\n\n${frame({ type: 'text', delta: 'ok' })}`;
    expect(parseSseBuffer(raw).events).toEqual([{ type: 'text', delta: 'ok' }]);
  });

  it('survives a stream split at every possible position', () => {
    const all: ChatEvent[] = [
      { type: 'tool-started', id: 't1', name: 'search_course', input: { query: 'q' } },
      { type: 'text', delta: 'Héllo “quoted” — text' },
      { type: 'usage', inputTokens: 3, outputTokens: 4 },
    ];
    const body = all.map(frame).join('');
    for (let i = 1; i < body.length; i++) {
      const first = parseSseBuffer(body.slice(0, i));
      const second = parseSseBuffer(first.rest + body.slice(i));
      expect([...first.events, ...second.events]).toEqual(all);
    }
  });
});
