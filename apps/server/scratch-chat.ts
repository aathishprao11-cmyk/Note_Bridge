import type { AddressInfo } from 'node:net';
import { parseConfig } from '@gyan/core';
import { buildApp } from './src/app';

const { app } = await buildApp({ config: parseConfig({ DATABASE_PATH: ':memory:' }) });
await app.listen({ port: 0, host: '127.0.0.1' });
const { port } = app.server.address() as AddressInfo;
const res = await fetch(`http://127.0.0.1:${port}/api/courses/course-phys101/chat`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: 'What is acceleration?' }),
});
console.log('HTTP', res.status, res.headers.get('content-type'));
const body = await res.text();
const frames = body.trim().split('\n\n');
console.log('frames:', frames.length);
for (const f of frames.slice(0, 3)) console.log(f.replace(/\n/g, ' | '));
console.log('...');
console.log(frames.slice(-3).join('\n\n'));
await app.close();
