import { describe, expect, it } from 'vitest';
import { AlignmentResponse, CoverageResponse } from '@gyan/core';
import { FRICTION, HEAT, pdf, setup } from './align-helpers';

const SLIDES = [
  {
    title: 'Friction on a block',
    body: 'The friction force equals the coefficient of friction times the normal force. Sliding surfaces.',
  },
  {
    title: 'Exam logistics',
    body: 'The final exam is on Friday. Bring a calculator and your student card to the hall.',
  },
];

describe('alignment on uploaded files (no model)', () => {
  it('turns slides into units, aligns them to the book, and computes coverage', async () => {
    const { app, courseId, upload, align } = await setup();
    await upload(
      'book',
      'book.pdf',
      await pdf([
        { title: '1 Friction', body: FRICTION },
        { title: '2 Heat', body: HEAT },
      ]),
    );
    await upload('slides', 'slides.pdf', await pdf(SLIDES));

    expect(await align()).toMatchObject({ status: 'done', error: null });

    const get = async (path: string) =>
      (await app.inject({ method: 'GET', url: `/api/courses/${courseId}/${path}` })).json();
    const map = AlignmentResponse.parse(await get('alignment'));
    expect(map.units.map((u) => u.unit.title)).toEqual(['Friction on a block', 'Exam logistics']);
    expect(map.edges.length).toBeGreaterThan(0);

    const [friction, exam] = map.units.map((u) => u.unit.id);
    const best = map.edges
      .filter((e) => e.unitId === friction)
      .sort((a, b) => b.confidence - a.confidence)[0]!;
    expect(map.chunks[best.chunkId]?.snippet).toMatch(/friction/i);

    // Honest labelling: no model ran, so only "covers" is claimed and confidence is capped.
    for (const e of map.edges) {
      expect(e.relation).toBe('covers');
      expect(e.claimVerdict).toBe('n/a');
      expect(e.signals.capsApplied).toContain('lexical_only');
      expect(e.confidence).toBeLessThanOrEqual(0.6);
      expect(e.rationale).toMatch(/no model judge/i);
    }
    // The unrelated slide matches nothing, so it is professor_only.
    expect(map.units.find((u) => u.unit.id === exam)?.professorOnly).toBe(true);
    expect(map.counts.professor_only).toBe(1);

    const cov = CoverageResponse.parse(await get('coverage'));
    expect(cov.totals).toMatchObject({ units: 2, professorOnlyUnits: 1 });
    await app.close();
  });

  it('fails the job with a clear message when there is nothing to align', async () => {
    const { app, upload, align } = await setup();
    await upload('book', 'b.pdf', await pdf([{ title: '1 Friction', body: FRICTION }]));
    const job = await align();
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/Upload slides or notes/);
    await app.close();
  });
});
