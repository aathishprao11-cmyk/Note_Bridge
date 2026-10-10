import { MockEmbeddingProvider, demo, parseConfig } from '@gyan/core';
import { buildApp } from '../src/app';
import { seedDemo } from '../src/db/seed-demo';

export const COURSE = demo.course.id;
export type Built = Awaited<ReturnType<typeof seededApp>>;

/** An in-memory app with the demo course seeded (mock embeddings: nothing is downloaded). */
export async function seededApp() {
  const built = await buildApp({ config: parseConfig({ DATABASE_PATH: ':memory:' }) });
  await seedDemo(built.db, new MockEmbeddingProvider(16));
  return built;
}

export const get = (app: Built['app'], url: string) => app.inject({ method: 'GET', url });
