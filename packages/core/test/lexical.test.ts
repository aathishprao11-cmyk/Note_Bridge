import { describe, expect, it } from 'vitest';
import { CAPS, alignLexical, bestSentence, computeConfidence, tokens } from '../src';

const passages = [
  {
    id: 'kin',
    header: 'Physics > Kinematics',
    text: 'Velocity is the rate of change of position. Acceleration is the rate of change of velocity.',
  },
  {
    id: 'fric',
    header: 'Physics > Friction',
    text: 'Friction opposes sliding between two surfaces. The friction force equals mu times the normal force.',
  },
  {
    id: 'therm',
    header: 'Physics > Heat',
    text: 'Heat flows from hot objects to cold objects until the temperatures are equal.',
  },
];

describe('lexical alignment', () => {
  it('ranks the passage that shares the unit vocabulary first', () => {
    const out = alignLexical(
      [{ id: 'u1', text: 'Friction force and the normal force on a sliding block' }],
      passages,
    );
    expect(out.get('u1')?.[0]?.passageId).toBe('fric');
  });

  it('is deterministic', () => {
    const q = [{ id: 'u1', text: 'velocity and acceleration of a moving body' }];
    expect(alignLexical(q, passages)).toEqual(alignLexical(q, passages));
  });

  it('returns nothing for a unit that shares no vocabulary (it becomes professor_only)', () => {
    const out = alignLexical(
      [{ id: 'u1', text: 'Tips for the final exam and office hours' }],
      passages,
    );
    expect(out.get('u1')).toEqual([]);
  });

  it('respects topK and minScore', () => {
    const q = [{ id: 'u1', text: 'velocity acceleration friction force heat position' }];
    expect(alignLexical(q, passages, { topK: 1, minScore: 0 }).get('u1')).toHaveLength(1);
    expect(alignLexical(q, passages, { topK: 5, minScore: 0.99 }).get('u1')).toEqual([]);
  });

  it('quotes verbatim sentences of at most 20 words from both sides', () => {
    const unit = 'Intro words here. The friction force equals mu times the normal force always.';
    const m = alignLexical([{ id: 'u1', text: unit }], passages).get('u1')?.[0];
    expect(unit).toContain(m!.unitQuote);
    expect(passages[1]!.text).toContain(m!.bookQuote);
    expect(m!.unitQuote.split(/\s+/).length).toBeLessThanOrEqual(20);
  });

  it('never matches on stop words alone', () => {
    expect(tokens('the and for with this that')).toEqual([]);
    expect(bestSentence('', 'anything')).toBe('');
  });
});

describe('computed confidence', () => {
  const strong = {
    retrievalScore: 1,
    quoteVerified: true,
    judgeAgreement: 1,
    top1Gap: 1,
    extractionQuality: 1,
    llmSelfReport: 1,
  };

  it('blends signals with the BRIEF weights when nothing caps it', () => {
    expect(computeConfidence(strong, { judgeRan: true }).confidence).toBe(1);
  });
  it('caps an unverified quote at 0.4', () => {
    const r = computeConfidence({ ...strong, quoteVerified: false }, { judgeRan: true });
    expect(r.confidence).toBeLessThanOrEqual(CAPS.quoteNotVerified);
    expect(r.signals.capsApplied).toContain('quote_not_verified');
  });
  it('caps a judge disagreement at 0.5', () => {
    const r = computeConfidence({ ...strong, judgeAgreement: 0 }, { judgeRan: true });
    expect(r.confidence).toBeLessThanOrEqual(CAPS.judgeDisagreement);
    expect(r.signals.capsApplied).toContain('judge_disagreement');
  });
  it('caps a low-quality source at 0.5', () => {
    const r = computeConfidence({ ...strong, extractionQuality: 0.4 }, { judgeRan: true });
    expect(r.confidence).toBeLessThanOrEqual(CAPS.lowQualitySource);
    expect(r.signals.capsApplied).toContain('low_quality_source');
  });
  it('caps lexical-only edges (no judge ran) and does not report a judge disagreement', () => {
    const r = computeConfidence({ ...strong, judgeAgreement: 0 }, { judgeRan: false });
    expect(r.confidence).toBeLessThanOrEqual(CAPS.lexicalOnly);
    expect(r.signals.capsApplied).toContain('lexical_only');
    expect(r.signals.capsApplied).not.toContain('judge_disagreement');
  });
  it('applies the lowest cap when several fire', () => {
    const r = computeConfidence(
      { ...strong, quoteVerified: false, extractionQuality: 0.3 },
      { judgeRan: false },
    );
    expect(r.confidence).toBeLessThanOrEqual(0.4);
  });
});
