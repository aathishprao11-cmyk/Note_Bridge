import { describe, expect, it } from 'vitest';
import { applyEvent, finishStreaming, newAssistantMessage } from '../src/lib/chat';
import type { Citation } from '../src/lib/chatTypes';

const cite = (over: Partial<Citation> = {}): Citation => ({
  documentId: 'doc_book',
  chunkId: 'chk_02',
  page: 5,
  printedPage: 2,
  quote: 'Acceleration is the rate of change of velocity.',
  status: 'verified',
  ...over,
});

const call = (summary: string, query = 'acceleration') => ({
  name: 'search_notes',
  input: { query },
  summary,
});

describe('applyEvent', () => {
  it('appends text deltas', () => {
    let m = newAssistantMessage('a1');
    m = applyEvent(m, { type: 'text', delta: 'Hello ' });
    m = applyEvent(m, { type: 'text', delta: 'world' });
    expect(m.text).toBe('Hello world');
    expect(m.status).toBe('streaming');
  });

  it('ignores the session event', () => {
    const m = newAssistantMessage('a1');
    expect(applyEvent(m, { type: 'session', sessionId: 'sess_1' })).toBe(m);
  });

  it('tracks a tool call from running to done with its "Looked up pages" summary', () => {
    let m = newAssistantMessage('a1');
    m = applyEvent(m, {
      type: 'tool-started',
      call: call("Searching your material for 'acceleration'"),
    });
    expect(m.tools[0]).toMatchObject({ status: 'running', query: 'acceleration' });
    m = applyEvent(m, { type: 'tool-finished', ok: true, call: call('Looked up pages 41-48') });
    expect(m.tools).toHaveLength(1);
    expect(m.tools[0]).toMatchObject({
      status: 'done',
      ok: true,
      summary: 'Looked up pages 41-48',
    });
  });

  it('pairs two calls with the same name in order', () => {
    let m = newAssistantMessage('a1');
    m = applyEvent(m, { type: 'tool-started', call: call('a', 'a') });
    m = applyEvent(m, { type: 'tool-started', call: call('b', 'b') });
    m = applyEvent(m, { type: 'tool-finished', ok: true, call: call('first done', 'a') });
    expect(m.tools.map((t) => [t.status, t.summary])).toEqual([
      ['done', 'first done'],
      ['running', 'b'],
    ]);
    m = applyEvent(m, { type: 'tool-finished', ok: true, call: call('second done', 'b') });
    expect(m.tools.map((t) => t.status)).toEqual(['done', 'done']);
  });

  it('keeps the latest usage (cumulative), not a running sum', () => {
    let m = newAssistantMessage('a1');
    m = applyEvent(m, { type: 'usage', inputTokens: 100, outputTokens: 0 });
    m = applyEvent(m, { type: 'usage', inputTokens: 100, outputTokens: 40 });
    expect(m.usage).toEqual({ inputTokens: 100, outputTokens: 40 });
  });

  it('replaces streamed text with the validated content on done, so stripped markers vanish', () => {
    let m = newAssistantMessage('a1');
    m = applyEvent(m, { type: 'text', delta: 'Real [1]. Fake [2].' });
    m = applyEvent(m, {
      type: 'done',
      messageId: 'msg_1',
      content: 'Real [1]. Fake.',
      citations: [cite()],
      unverifiedCalculation: false,
      abstained: false,
      confidence: 0.8,
    });
    expect(m).toMatchObject({ text: 'Real [1]. Fake.', status: 'done', confidence: 0.8, id: 'a1' });
    expect(m.citations).toHaveLength(1);
  });

  it('records an error event, and never mutates its input', () => {
    const before = newAssistantMessage('a1');
    const m = applyEvent(before, { type: 'error', code: 'x', message: 'nope' });
    expect(m).toMatchObject({ status: 'error', error: 'nope' });
    expect(before.status).toBe('streaming');
  });

  it('finishStreaming stops a streaming message and leaves finished ones alone', () => {
    const streaming = newAssistantMessage('a1');
    expect(finishStreaming(streaming).status).toBe('done');
    expect(finishStreaming(streaming, 'lost').status).toBe('error');
    const done = { ...streaming, status: 'done' as const };
    expect(finishStreaming(done, 'lost')).toBe(done);
  });
});
