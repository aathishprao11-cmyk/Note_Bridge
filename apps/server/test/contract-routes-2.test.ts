import { describe, expect, it } from 'vitest';
import {
  CoverageResponse,
  EdgeSignalsResponse,
  PatchEdgeResponse,
  UnitDetailResponse,
} from '@gyan/core';
import { COURSE, get, seededApp } from './contract-helpers';

type App = Awaited<ReturnType<typeof seededApp>>['app'];
const patch = (app: App, id: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'PATCH', url: `/api/edges/${id}`, payload });

describe('alignment routes: write', () => {
  it('persists confirm, reject and remap and records feedback', async () => {
    const { app, db } = await seededApp();
    const ok = await patch(app, 'edge_02', { action: 'confirm' });
    expect(PatchEdgeResponse.parse(ok.json()).userStatus).toBe('confirmed');
    expect((await patch(app, 'edge_03', { action: 'reject' })).json().userStatus).toBe('rejected');

    const remap = await patch(app, 'edge_07', { action: 'remap', chunkId: 'chk_09' });
    expect(remap.json()).toMatchObject({ userStatus: 'remapped', chunkId: 'chk_09' });

    const stored = db
      .prepare("SELECT user_status FROM alignment_edges WHERE id = 'edge_02'")
      .get() as { user_status: string };
    expect(stored.user_status).toBe('confirmed');
    const fb = db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE edge_id = 'edge_02'").get() as {
      n: number;
    };
    expect(fb.n).toBe(1);
    await app.close();
  });

  it('rejects bad patches with typed errors', async () => {
    const { app } = await seededApp();
    expect((await patch(app, 'edge_02', { action: 'delete' })).statusCode).toBe(400);
    expect((await patch(app, 'edge_02', { action: 'remap' })).statusCode).toBe(400);
    expect((await patch(app, 'nope', { action: 'confirm' })).json().error.code).toBe(
      'edge_not_found',
    );
    const ghost = await patch(app, 'edge_02', { action: 'remap', chunkId: 'ghost' });
    expect(ghost.json().error.code).toBe('chunk_not_found');
    // unit_01 is already matched to chk_01 by edge_01; remapping edge_08 there would duplicate it.
    expect((await patch(app, 'edge_08', { action: 'remap', chunkId: 'chk_01' })).statusCode).toBe(
      409,
    );
    await app.close();
  });

  it('explains a match with its signals and weights', async () => {
    const { app } = await seededApp();
    const res = EdgeSignalsResponse.parse((await get(app, '/api/edges/edge_13/signals')).json());
    expect(res.signals.capsApplied).toContain('quote_not_verified');
    expect(res.confidence).toBeLessThanOrEqual(0.4);
    expect(res.weights.retrieval).toBeCloseTo(0.3);
    expect((await get(app, '/api/edges/nope/signals')).statusCode).toBe(404);
    await app.close();
  });

  it('returns unit detail with neighbours, and coverage', async () => {
    const { app } = await seededApp();
    const unit = UnitDetailResponse.parse((await get(app, '/api/units/unit_04')).json());
    expect(unit.prevUnitId).toBe('unit_03');
    expect(unit.nextUnitId).toBe('unit_05');
    expect(unit.edges.length).toBeGreaterThan(1);
    expect((await get(app, '/api/units/nope')).statusCode).toBe(404);

    const cov = CoverageResponse.parse((await get(app, `/api/courses/${COURSE}/coverage`)).json());
    expect(cov.totals.professorOnlyUnits).toBe(2);
    expect((await get(app, '/api/courses/nope/coverage')).statusCode).toBe(404);
    await app.close();
  });

  it('starts an align job for a known course only', async () => {
    const { app } = await seededApp();
    const ok = await app.inject({
      method: 'POST',
      url: `/api/courses/${COURSE}/align`,
      payload: {},
    });
    expect(ok.statusCode).toBe(202);
    expect(ok.json().jobId).toMatch(/^job_/);
    const missing = await app.inject({
      method: 'POST',
      url: '/api/courses/nope/align',
      payload: {},
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});
