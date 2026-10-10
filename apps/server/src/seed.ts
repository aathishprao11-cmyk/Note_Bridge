import { createEmbeddingProvider } from '@gyan/core';
import { loadConfig } from './config';
import { openDb } from './db';
import { seedDemo } from './db/seed-demo';

// pnpm seed            load the demo course if it is not there yet
// pnpm seed --reset    delete the demo course (and any edits to it) and reload it
const config = loadConfig();
const db = openDb(config.DATABASE_PATH);
const result = await seedDemo(db, createEmbeddingProvider(config), {
  reset: process.argv.includes('--reset'),
});
db.close();

if (result.skipped) {
  console.log(`[seed] course "${result.courseId}" already exists; nothing changed (use --reset).`);
} else {
  console.log(`[seed] loaded course "${result.courseId}" into ${config.DATABASE_PATH}`);
  console.log('[seed] rows:', JSON.stringify(result.counts));
}
