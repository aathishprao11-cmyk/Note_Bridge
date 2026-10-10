import { describe, expect, it } from 'vitest';
import {
  ChatEvent,
  ChatExamplesResponse,
  UNVERIFIED_CITATION_MARK,
  type ChatEventPayload,
} from '@gyan/core';
import Fastify from 'fastify';
import { registerChatRoutes } from '../src/routes/chat';
import { validateCannedEvents } from '../src/routes/chat-validate';
import { COURSE, get, seededApp } from './contract-helpers';

type Done = Extract<ChatEventPayload, { type: 'done' }>;
const parse = (body: string) =>
  body
    .split('\n\n')
    .filter(Boolean)
    .map((c) => ChatEvent.parse(JSON.parse(c.replace(/^data: /, ''))));
const doneOf = (events: ChatEventPayload[]): Done =>
  events.find((e): e is Done => e.type === 'done')!;

describe('canned chat answers pass answer-validation', () => {
  it('verifies the grounded answer: its citation resolves to the stored printed page', async () => {
    const { app } = await seededApp();
    const ex = ChatExamplesResponse.parse(
      (await get(app, `/api/courses/${COURSE}/chat/examples`)).json(),
    ).find((e) => e.id === 'chat_conflict')!;
    const done = doneOf(ex.events);
    expect(done.citations).toHaveLength(1);
    expect(done.citations[0]).toMatchObject({ status: 'verified', printedPage: 3 });
    expect(done.content).not.toContain(UNVERIFIED_CITATION_MARK);
    expect(done.confidence).toBe(0.8);
    await app.close();
  });

  it('marks the unmatched citation "unverified" and the text "(unverified citation)"', async () => {
    const { app } = await seededApp();
    const ex = ChatExamplesResponse.parse(
      (await get(app, `/api/courses/${COURSE}/chat/examples`)).json(),
    ).find((e) => e.id === 'chat_unverified')!;
    const done = doneOf(ex.events);
    // The fixture cites chk_13 for Exercise 1.1, but that chunk is Exercise 2.1 and the tool
    // found only chk_06 / chk_07 for "free fall"; so validation, not the fixture, flags it.
    expect(done.citations[0]?.status).toBe('unverified');
    expect(done.content).toContain(UNVERIFIED_CITATION_MARK);
    expect(done.unverifiedCalculation).toBe(true);
    expect(done.confidence).toBeLessThanOrEqual(0.4);
    const streamed = ex.events
      .filter((e): e is Extract<ChatEventPayload, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');
    expect(streamed).toContain(UNVERIFIED_CITATION_MARK);
    await app.close();
  });

  it('keeps the abstention an abstention, with no confidence', async () => {
    const { app } = await seededApp();
    const ex = ChatExamplesResponse.parse(
      (await get(app, `/api/courses/${COURSE}/chat/examples`)).json(),
    ).find((e) => e.id === 'chat_abstain')!;
    const done = doneOf(ex.events);
    expect(done).toMatchObject({ abstained: true, confidence: null, citations: [] });
    await app.close();
  });

  it('streams validated answers from the stub POST /chat (mounted on its own server)', async () => {
    // app.ts hands POST /chat to the Study Agent, so mount the stub route alone to test it.
    const { app: full, db } = await seededApp();
    const stub = Fastify({ logger: false });
    registerChatRoutes(stub, db);
    const res = await stub.inject({
      method: 'POST',
      url: `/api/courses/${COURSE}/chat`,
      payload: { message: 'How long does Exercise 1.1 take? Free fall exercises please.' },
    });
    const done = doneOf(parse(res.body));
    expect(done.citations.some((c) => c.status === 'unverified')).toBe(true);
    expect(done.content).toContain(UNVERIFIED_CITATION_MARK);
    await stub.close();
    await full.close();
  });
});
describe('validateCannedEvents', () => {
  it('overrides a verified status the fixture claims but the evidence does not support', async () => {
    const { app, db } = await seededApp();
    const events: ChatEventPayload[] = [
      { type: 'session', sessionId: 's' },
      {
        type: 'done',
        messageId: 'm',
        content: 'Claim [University Physics, p.3].',
        citations: [
          {
            documentId: 'doc_book',
            chunkId: 'chk_04',
            page: 6,
            printedPage: 3,
            quote: 'x = x0 + v0 t + (1/2) a t²',
            status: 'verified', // claimed, but no tool call returned chk_04 in this answer
          },
        ],
        unverifiedCalculation: false,
        abstained: false,
        confidence: 0.99,
      },
    ];
    const done = doneOf(validateCannedEvents(db, COURSE, 'q', events));
    expect(done.citations[0]?.status).toBe('unverified');
    expect(done.content).toContain(UNVERIFIED_CITATION_MARK);
    expect(done.confidence).toBeLessThan(0.99);
    await app.close();
  });

  it('verifies the same citation once a tool call returns its page', async () => {
    const { app, db } = await seededApp();
    const call = {
      name: 'get_book_section',
      input: { book_id: 'doc_book', page_start: 6, page_end: 6 },
      summary: 's',
    };
    const events: ChatEventPayload[] = [
      { type: 'tool-finished', call, ok: true },
      {
        type: 'done',
        messageId: 'm',
        content: 'Claim [University Physics, p.3].',
        citations: [
          {
            documentId: 'doc_book',
            chunkId: 'chk_04',
            page: 1,
            printedPage: 1, // wrong pages from the "model": code overwrites them from the chunk
            quote: 'x = x0 + v0 t + (1/2) a t²',
            status: 'unverified',
          },
        ],
        unverifiedCalculation: false,
        abstained: false,
        confidence: null,
      },
    ];
    const done = doneOf(validateCannedEvents(db, COURSE, 'q', events));
    expect(done.citations[0]).toMatchObject({ status: 'verified', page: 6, printedPage: 3 });
    expect(done.content).not.toContain(UNVERIFIED_CITATION_MARK);
    await app.close();
  });
});
