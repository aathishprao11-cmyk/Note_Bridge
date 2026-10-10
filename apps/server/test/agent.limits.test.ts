import { describe, expect, it } from 'vitest';
import { COURSE, post, withServer } from './agent-route-helpers';
import { seededApp } from './agent-helpers';

describe('POST /chat validation and limits', () => {
  it('rejects an empty or non-string message with the contract error shape', async () => {
    await withServer(async (base) => {
      for (const body of [{}, { message: '   ' }, { message: 42 }]) {
        const res = await post(base, body);
        expect(res.status).toBe(400);
        expect(res.headers.get('content-type')).toContain('application/json');
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad_request');
      }
    });
  });

  it('returns 404 course_not_found for an unknown course', async () => {
    await withServer(async (base) => {
      const res = await post(base, { message: 'hello there' }, 'no-such-course');
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('course_not_found');
    });
  });

  it('rate-limits to 20 requests a minute', async () => {
    await withServer(async (base) => {
      let last = 0;
      for (let i = 0; i < 21; i++) {
        const res = await post(base, { message: 'What is velocity?' });
        last = res.status;
        await res.text();
      }
      expect(last).toBe(429);
    });
  });

  it('keeps GET /chat/examples from the contract stub', async () => {
    const { app } = await seededApp();
    const res = await app.inject({ method: 'GET', url: `/api/courses/${COURSE}/chat/examples` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as unknown[]).length).toBeGreaterThan(0);
    await app.close();
  });
});
