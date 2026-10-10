import { describe, expect, it } from 'vitest';
import {
  AlignmentResponse,
  CourseResponse,
  ListCoursesResponse,
  MockEmbeddingProvider,
  demo,
} from '@gyan/core';
import { seedDemo } from '../src/db/seed-demo';
import { COURSE, get, seededApp, type Built } from './contract-helpers';

const count = (db: Built['db'], sql: string) => (db.prepare(sql).get() as { n: number }).n;

describe('seed', () => {
  it('loads the demo course once and is idempotent', async () => {
    const { db, app } = await seededApp();
    const again = await seedDemo(db, new MockEmbeddingProvider(16));
    expect(again.skipped).toBe(true);
    expect(count(db, 'SELECT COUNT(*) AS n FROM lecture_units')).toBe(12);
    expect(count(db, 'SELECT COUNT(*) AS n FROM alignment_edges')).toBe(demo.edges.length);
    expect(count(db, 'SELECT COUNT(*) AS n FROM chunks')).toBe(demo.chunks.length);
    await app.close();
  });

  it('--reset restores edits made to the demo course', async () => {
    const { db, app } = await seededApp();
    db.prepare("UPDATE alignment_edges SET user_status = 'rejected'").run();
    const res = await seedDemo(db, new MockEmbeddingProvider(16), { reset: true });
    expect(res.skipped).toBe(false);
    expect(
      count(db, "SELECT COUNT(*) AS n FROM alignment_edges WHERE user_status = 'rejected'"),
    ).toBe(demo.edges.filter((e) => e.userStatus === 'rejected').length);
    await app.close();
  });

  it('fixtures cover every relation, flag, conflict type and a low-confidence edge', () => {
    expect(new Set(demo.edges.map((e) => e.relation))).toEqual(
      new Set(['covers', 'extends', 'conflicts']),
    );
    expect(demo.unitFlags.length).toBeGreaterThan(0); // professor_only
    expect(demo.chunkFlags.length).toBeGreaterThan(0); // book_only
    const types = new Set(demo.edges.map((e) => e.conflictType).filter(Boolean));
    expect(types).toEqual(new Set(['formula', 'notation', 'sign_convention', 'scope']));
    expect(demo.edges.some((e) => e.confidence < 0.5)).toBe(true);
    expect(demo.units).toHaveLength(12);
    expect(demo.exercises.some((e) => !e.hasSolution)).toBe(true);
  });

  it('fixture confidence obeys the hard caps', () => {
    for (const e of demo.edges) {
      if (!e.quoteVerified) expect(e.confidence).toBeLessThanOrEqual(0.4);
      if (e.signals.judgeAgreement === 0) expect(e.confidence).toBeLessThanOrEqual(0.5);
      if (e.signals.extractionQuality < 0.6) expect(e.confidence).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('course routes', () => {
  it('creates, lists and fetches courses and validates the body', async () => {
    const { app } = await seededApp();
    const bad = await app.inject({ method: 'POST', url: '/api/courses', payload: { name: ' ' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('bad_request');

    const made = await app.inject({
      method: 'POST',
      url: '/api/courses',
      payload: { name: 'Maths' },
    });
    expect(made.statusCode).toBe(201);
    const course = CourseResponse.parse(made.json());

    const list = ListCoursesResponse.parse((await get(app, '/api/courses')).json());
    expect(list.map((c) => c.id)).toEqual(expect.arrayContaining([COURSE, course.id]));
    const one = CourseResponse.parse((await get(app, `/api/courses/${course.id}`)).json());
    expect(one.name).toBe('Maths');

    const missing = await get(app, '/api/courses/nope');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('course_not_found');
    await app.close();
  });
});

describe('alignment routes: read', () => {
  const url = (q: string) => `/api/courses/${COURSE}/alignment?${q}`;

  it('returns the alignment map with counts for all five relation types', async () => {
    const { app } = await seededApp();
    const all = AlignmentResponse.parse((await get(app, url(''))).json());
    expect(all.units).toHaveLength(12);
    expect(all.edges).toHaveLength(demo.edges.length);
    expect(all.counts).toMatchObject({ professor_only: 2, book_only: 4 });
    expect(all.counts.covers + all.counts.extends + all.counts.conflicts).toBe(demo.edges.length);
    for (const e of all.edges) expect(all.chunks[e.chunkId]).toBeDefined();
    await app.close();
  });

  it('honours relation, confidence and flag filters', async () => {
    const { app } = await seededApp();
    const conflicts = AlignmentResponse.parse((await get(app, url('relation=conflicts'))).json());
    expect(conflicts.edges.length).toBeGreaterThan(0);
    expect(conflicts.edges.every((e) => e.relation === 'conflicts')).toBe(true);

    const high = AlignmentResponse.parse((await get(app, url('minConfidence=0.8'))).json());
    expect(high.edges.every((e) => e.confidence >= 0.8)).toBe(true);

    const prof = AlignmentResponse.parse((await get(app, url('relation=professor_only'))).json());
    expect(prof.units.length).toBe(2);
    expect(prof.units.every((u) => u.professorOnly)).toBe(true);
    expect(prof.edges).toEqual([]);

    expect((await get(app, url('relation=same'))).statusCode).toBe(400);
    expect((await get(app, '/api/courses/nope/alignment')).statusCode).toBe(404);
    await app.close();
  });

  it('book chunks carry printed pages from the offset', async () => {
    const { app } = await seededApp();
    const all = AlignmentResponse.parse((await get(app, url(''))).json());
    expect(all.chunks['chk_04']?.pdfPageStart).toBe(6);
    expect(all.chunks['chk_04']?.printedPageStart).toBe(3);
    await app.close();
  });
});
