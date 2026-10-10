import { describe, expect, it } from 'vitest';
import { AlignmentResponse, CoverageResponse } from '@gyan/core';
import { COURSE, get, seededApp } from './contract-helpers';

/** /alignment flags and /coverage are computed from stored edges, not read from fixtures. */
describe('live coverage and flags', () => {
  const cov = async (app: Awaited<ReturnType<typeof seededApp>>['app']) =>
    CoverageResponse.parse((await get(app, `/api/courses/${COURSE}/coverage`)).json());
  const align = async (app: Awaited<ReturnType<typeof seededApp>>['app']) =>
    AlignmentResponse.parse((await get(app, `/api/courses/${COURSE}/alignment`)).json());

  it('matches the hand-checked numbers for the seeded course', async () => {
    const { app } = await seededApp();
    const c = await cov(app);
    expect(c.chapters.map((x) => [x.chapter, x.matchedPages, x.totalPages])).toEqual([
      ['1 Kinematics', 4, 5],
      ["2 Newton's Laws", 3, 6],
    ]);
    expect(c.totals).toMatchObject({ units: 12, professorOnlyUnits: 2, conflicts: 4 });
    await app.close();
  });

  it('changes coverage when the student rejects an edge', async () => {
    const { app, db } = await seededApp();
    const before = await cov(app);
    // edge_01 (confirmed) is the only edge to chunk chk_01; rejecting it uncovers that passage.
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/edges/edge_01',
      payload: { action: 'reject' },
    });
    expect(res.statusCode).toBe(200);
    const after = await cov(app);
    expect(after.chapters[0]!.matchedPages).toBeLessThanOrEqual(before.chapters[0]!.matchedPages);
    const flags = db.prepare('SELECT COUNT(*) AS n FROM unit_flags').get() as { n: number };
    expect(flags.n).toBe(after.totals.professorOnlyUnits);
    await app.close();
  });

  it('turns a unit professor_only when its last counted edge is rejected, and back on confirm', async () => {
    const { app } = await seededApp();
    const patch = (id: string, action: 'reject' | 'confirm') =>
      app.inject({ method: 'PATCH', url: `/api/edges/${id}`, payload: { action } });
    // unit_06 has exactly one edge (edge_07).
    expect((await align(app)).units.find((u) => u.unit.id === 'unit_06')?.professorOnly).toBe(
      false,
    );
    await patch('edge_07', 'reject');
    expect((await align(app)).units.find((u) => u.unit.id === 'unit_06')?.professorOnly).toBe(true);
    expect((await cov(app)).totals.professorOnlyUnits).toBe(3);
    await patch('edge_07', 'confirm');
    expect((await align(app)).units.find((u) => u.unit.id === 'unit_06')?.professorOnly).toBe(
      false,
    );
    expect((await cov(app)).totals.professorOnlyUnits).toBe(2);
    await app.close();
  });

  it('a confirmed weak edge counts; an unverified one does not', async () => {
    const { app, db } = await seededApp();
    // edge_13 is unit_09 -> chk_02, unverified quote, confidence 0.4: it must not count.
    const before = (await align(app)).units.find((u) => u.unit.id === 'unit_09');
    expect(before?.professorOnly).toBe(false); // unit_09 still has edge_11
    db.prepare("UPDATE alignment_edges SET user_status = 'rejected' WHERE id = 'edge_11'").run();
    expect((await align(app)).units.find((u) => u.unit.id === 'unit_09')?.professorOnly).toBe(true);
    await app.inject({
      method: 'PATCH',
      url: '/api/edges/edge_13',
      payload: { action: 'confirm' },
    });
    expect((await align(app)).units.find((u) => u.unit.id === 'unit_09')?.professorOnly).toBe(
      false,
    );
    await app.close();
  });

  it('gives an empty, honest report for a course with no material', async () => {
    const { app } = await seededApp();
    const made = await app.inject({
      method: 'POST',
      url: '/api/courses',
      payload: { name: 'Empty' },
    });
    const res = await get(app, `/api/courses/${made.json().id}/coverage`);
    const c = CoverageResponse.parse(res.json());
    expect(c.chapters).toEqual([]);
    expect(c.totals.units).toBe(0);
    await app.close();
  });
});
