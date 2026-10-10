import { describe, expect, it } from 'vitest';
import { parseConfig } from '@gyan/core';
import {
  DEMO_SCRIPTS,
  MockScriptWriter,
  createVerifierPlugin,
  verify,
  type SandboxRun,
} from '@gyan/feature-verifier';
import { buildApp } from '../src/app';
import { createSandbox } from '../src/sandbox';

const sandbox = createSandbox({ mode: 'local', log: () => {} });
const run: SandboxRun = (req) => sandbox.run(req);

describe('verifier + real local sandbox (mock script writer)', () => {
  it('verifies a correct claim by actually running code', async () => {
    const writer = new MockScriptWriter({
      'sum 1..100': {
        language: 'node',
        code: 'let s=0;for(let i=1;i<=100;i++)s+=i;console.log(s)',
      },
    });
    const r = await verify({ claim: 'sum 1..100', expected: '5050' }, { writer, run });
    expect(r.status).toBe('verified');
    if (r.status === 'verified') {
      expect(r.actual).toBe('5050');
      expect(r.ran.mode).toBe('local');
    }
  });

  it('mismatch case: expected 42, the code prints 41', async () => {
    const writer = new MockScriptWriter({ q: { language: 'node', code: 'console.log(41)' } });
    const r = await verify({ claim: 'q', expected: '42' }, { writer, run });
    expect(r.status).toBe('mismatch');
    if (r.status === 'mismatch') {
      expect(r.expected).toBe('42');
      expect(r.actual).toBe('41');
      expect(r.diff).toEqual([
        { kind: 'removed', text: '42' },
        { kind: 'added', text: '41' },
      ]);
    }
  });

  it('catches a wrong textbook value: KE of 2 kg at 3 m/s is 9 J, not 18 J', async () => {
    const claim = 'kinetic energy of a 2 kg mass moving at 3 m/s in joules';
    const writer = new MockScriptWriter(DEMO_SCRIPTS);
    expect((await verify({ claim, expected: '18' }, { writer, run })).status).toBe('mismatch');
    expect((await verify({ claim, expected: '9' }, { writer, run })).status).toBe('verified');
  });

  it('returns a timeout error for a script that never ends', async () => {
    const writer = new MockScriptWriter({ hang: { language: 'node', code: 'while(true){}' } });
    const short: SandboxRun = (req) => sandbox.run({ ...req, timeoutMs: 400 });
    const r = await verify({ claim: 'hang', expected: '1' }, { writer, run: short });
    expect(r).toMatchObject({ status: 'error', reason: 'timeout' });
  });

  it('returns an output_limit error when the script floods stdout', async () => {
    const writer = new MockScriptWriter({
      flood: { language: 'node', code: 'process.stdout.write("x".repeat(100000))' },
    });
    const r = await verify({ claim: 'flood', expected: '1' }, { writer, run });
    expect(r).toMatchObject({ status: 'error', reason: 'output_limit' });
  });

  it('refuses a script that asks for a disallowed interpreter', async () => {
    const writer = new MockScriptWriter({
      sneaky: { language: 'bash' as 'node', code: 'echo 42' },
    });
    const r = await verify({ claim: 'sneaky', expected: '42' }, { writer, run });
    expect(r).toMatchObject({ status: 'error', reason: 'sandbox_error' });
  });

  it('a script cannot read the server environment', async () => {
    process.env.GYAN_VERIFY_SECRET = 'leak-me';
    try {
      const writer = new MockScriptWriter({
        env: { language: 'node', code: 'console.log(process.env.GYAN_VERIFY_SECRET ?? "hidden")' },
      });
      const r = await verify({ claim: 'env', expected: 'hidden' }, { writer, run });
      expect(r.status).toBe('verified');
    } finally {
      delete process.env.GYAN_VERIFY_SECRET;
    }
  });
});

describe('server wiring', () => {
  it('mounts the verifier from PLUGINS, hands it the sandbox, and serves /verify over HTTP', async () => {
    const plugin = createVerifierPlugin();
    const { app, plugins } = await buildApp({
      config: parseConfig({
        DATABASE_PATH: ':memory:',
        PLUGINS: 'verifier',
        SANDBOX_MODE: 'local',
      }),
      importer: async () => ({ default: plugin }),
    });
    expect(plugins.map((p) => p.id)).toEqual(['verifier']);

    const claim = 'sum of the integers 1 to 100';
    const ok = await app.inject({
      method: 'POST',
      url: '/api/features/verifier/verify',
      payload: { claim, expected: '5050' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'verified', actual: '5050' });

    const bad = await app.inject({
      method: 'POST',
      url: '/api/features/verifier/verify',
      payload: { claim, expected: '5051' },
    });
    expect(bad.json()).toMatchObject({ status: 'mismatch', actual: '5050' });
    await app.close();
  });
});
