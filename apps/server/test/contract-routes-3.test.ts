import { describe, expect, it } from 'vitest';
import {
  ChatEvent,
  ChatExamplesResponse,
  ListDocumentsResponse,
  PageResponse,
  QualityResponse,
} from '@gyan/core';
import { COURSE, get, seededApp } from './contract-helpers';

describe('document routes', () => {
  it('lists documents and serves a page with printed numbers', async () => {
    const { app } = await seededApp();
    const docs = ListDocumentsResponse.parse(
      (await get(app, `/api/courses/${COURSE}/documents`)).json(),
    );
    expect(docs.map((d) => d.kind).sort()).toEqual(['book', 'handwritten', 'slides']);

    const page = PageResponse.parse((await get(app, '/api/documents/doc_book/pages/6')).json());
    expect(page.page.pdfPage).toBe(6);
    expect(page.page.printedPage).toBe(3);
    expect(page.chunks.map((c) => c.id)).toEqual(expect.arrayContaining(['chk_03', 'chk_04']));
    const past = await get(app, '/api/documents/doc_book/pages/99');
    expect(past.json().error.code).toBe('page_not_found');
    expect((await get(app, '/api/documents/doc_book/pages/zero')).statusCode).toBe(400);
    expect((await get(app, '/api/documents/nope/pages/1')).statusCode).toBe(404);
    await app.close();
  });

  it('reports extraction quality per page and per document', async () => {
    const { app } = await seededApp();
    const q = QualityResponse.parse((await get(app, '/api/documents/doc_notes/quality')).json());
    expect(q.extractionQuality).toBeLessThan(0.7);
    expect(q.pages).toHaveLength(4);
    expect(q.pages.some((p) => p.score < 0.5)).toBe(true);
    expect(q.warnings.length).toBeGreaterThan(0);
    const book = QualityResponse.parse((await get(app, '/api/documents/doc_book/quality')).json());
    expect(book.pageOffset).toBe(-3);
    expect((await get(app, '/api/documents/nope/quality')).statusCode).toBe(404);
    await app.close();
  });
});

describe('chat routes', () => {
  const sse = (body: string) =>
    body
      .split('\n\n')
      .filter(Boolean)
      .map((chunk) => ChatEvent.parse(JSON.parse(chunk.replace(/^data: /, ''))));
  const ask = (app: Awaited<ReturnType<typeof seededApp>>['app'], message: string) =>
    app.inject({ method: 'POST', url: `/api/courses/${COURSE}/chat`, payload: { message } });

  it('streams a cited answer with tool events as schema-valid SSE', async () => {
    const { app } = await seededApp();
    const res = await ask(app, "Why does my professor's position formula differ from the book's?");
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = sse(res.body);
    expect(events.some((e) => e.type === 'tool-started')).toBe(true);
    const done = events.find((e) => e.type === 'done');
    expect(done?.type === 'done' && done.citations[0]?.printedPage).toBe(3);
    await app.close();
  });

  it('abstains when nothing in the material matches', async () => {
    const { app } = await seededApp();
    const done = sse((await ask(app, 'Explain zebras migration')).body).find(
      (e) => e.type === 'done',
    );
    expect(done?.type === 'done' && done.abstained).toBe(true);
    await app.close();
  });

  it('validates the body and the course, and serves examples incl. an unverified citation', async () => {
    const { app } = await seededApp();
    const bad = await app.inject({
      method: 'POST',
      url: `/api/courses/${COURSE}/chat`,
      payload: {},
    });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'POST',
      url: '/api/courses/nope/chat',
      payload: { message: 'hi' },
    });
    expect(missing.statusCode).toBe(404);
    const ex = ChatExamplesResponse.parse(
      (await get(app, `/api/courses/${COURSE}/chat/examples`)).json(),
    );
    const unverified = ex.some((e) =>
      e.events.some((v) => v.type === 'done' && v.citations.some((c) => c.status === 'unverified')),
    );
    expect(unverified).toBe(true);
    await app.close();
  });
});
