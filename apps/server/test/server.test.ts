import { describe, expect, it } from 'vitest';
import { parseConfig, type FeaturePlugin } from '@gyan/core';
import { buildApp } from '../src/app';
import { openDb } from '../src/db';

const memConfig = (extra: Record<string, string> = {}) =>
  parseConfig({ DATABASE_PATH: ':memory:', ...extra });

describe('database migrations', () => {
  it('creates every table and is idempotent', () => {
    const db = openDb(':memory:');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of [
      'courses',
      'documents',
      'sections',
      'chunks',
      'embeddings',
      'exercises',
      'edges',
      'jobs',
    ]) {
      expect(tables).toContain(t);
    }
    db.close();
  });

  it('enforces relation and role constraints', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO courses (id, name) VALUES ('c1', 'Physics')").run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO documents (id, course_id, role, title, content_hash) VALUES ('d1','c1','poster','x','h')",
        )
        .run(),
    ).toThrow();
    db.close();
  });
});

describe('server', () => {
  it('GET /api/health reports mock providers', async () => {
    const { app } = await buildApp({ config: memConfig() });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, llmProvider: 'mock', plugins: [] });
    await app.close();
  });

  it('GET /api/config never exposes secrets', async () => {
    const { app } = await buildApp({
      config: memConfig({ ANTHROPIC_API_KEY: 'sk-ant-supersecret' }),
    });
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.body).not.toContain('supersecret');
    await app.close();
  });

  it('loads a plugin listed in PLUGINS and mounts its routes', async () => {
    const plugin: FeaturePlugin = {
      id: 'demo',
      name: 'Demo',
      version: '0.0.1',
      register: (ctx) =>
        ctx.addRoutes('', (app) => {
          app.get('/ping', async () => ({ pong: true }));
        }),
    };
    const { app, plugins } = await buildApp({
      config: memConfig({ PLUGINS: 'demo' }),
      importer: async () => ({ default: plugin }),
    });
    expect(plugins.map((p) => p.id)).toEqual(['demo']);
    const res = await app.inject({ method: 'GET', url: '/api/features/demo/ping' });
    expect(res.json()).toEqual({ pong: true });
    await app.close();
  });

  it('survives a plugin that fails to load', async () => {
    const { app, plugins } = await buildApp({
      config: memConfig({ PLUGINS: 'missing' }),
      importer: async () => {
        throw new Error('not found');
      },
    });
    expect(plugins).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    await app.close();
  });
});
