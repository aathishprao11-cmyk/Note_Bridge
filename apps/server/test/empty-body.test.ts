import { describe, expect, it } from 'vitest';
import { COURSE, seededApp } from './contract-helpers';

const json = { 'content-type': 'application/json' };

describe('JSON bodies', () => {
  it('accepts a POST with a JSON content-type and no body (what the web app sends)', async () => {
    const { app } = await seededApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/courses/${COURSE}/align`,
      headers: json,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().jobId).toMatch(/^job_/);
    await app.close();
  });

  it('accepts whitespace-only bodies and an explicit {}', async () => {
    const { app } = await seededApp();
    for (const payload of ['', '   ', '{}']) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/courses/${COURSE}/align`,
        headers: json,
        payload,
      });
      expect(res.statusCode).toBe(202);
    }
    await app.close();
  });

  it('still validates bodies: an empty body is not a valid new course', async () => {
    const { app } = await seededApp();
    const res = await app.inject({ method: 'POST', url: '/api/courses', headers: json });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('bad_request');
    await app.close();
  });

  it('still rejects malformed JSON with a 400', async () => {
    const { app } = await seededApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/courses',
      headers: json,
      payload: '{ not json',
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('parses a normal JSON body as before', async () => {
    const { app } = await seededApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/courses',
      headers: json,
      payload: JSON.stringify({ name: 'Chemistry' }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('Chemistry');
    await app.close();
  });
});
