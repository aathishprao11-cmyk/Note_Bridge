/**
 * Pure scoring for the eval (BRIEF 9.5). No database, no files: the runner feeds it data so these
 * functions stay unit-testable. A unit with an empty correct_book has NO answer in the books
 * (professor_only): the right behaviour is to leave it without a counted edge.
 */

export interface KeyRow {
  unit: string;
  book: string;
  pageStart: number | null;
  pageEnd: number | null;
}

export interface Prediction {
  book: string;
  /** Printed pages, because that is what the key and the student use. */
  printedStart: number;
  printedEnd: number;
  confidence: number;
  /** Would this edge count in coverage (confident, quote-verified, ...)? */
  counted: boolean;
}

export interface Ratio {
  hits: number;
  total: number;
  /** 0..1, or null when there is nothing to score (never reported as 0 or 1). */
  rate: number | null;
}

export const ratio = (hits: number, total: number): Ratio => ({
  hits,
  total,
  rate: total === 0 ? null : hits / total,
});

export const hasAnswer = (row: KeyRow): boolean => row.book !== '';

/** Best first. Ties keep input order so the result is deterministic. */
export function rank(preds: Prediction[]): Prediction[] {
  return preds
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p.confidence - a.p.confidence || a.i - b.i)
    .map((x) => x.p);
}

/** Right book and the predicted page range overlaps the key's page range. */
export function isHit(row: KeyRow, p: Prediction): boolean {
  if (row.pageStart === null || row.pageEnd === null) return false;
  return p.book === row.book && p.printedStart <= row.pageEnd && p.printedEnd >= row.pageStart;
}

/** Share of answerable units whose correct passage is among the top-k ranked edges. */
export function accuracyAtK(
  rows: KeyRow[],
  predsByUnit: Map<string, Prediction[]>,
  k: number,
): Ratio {
  const answerable = rows.filter(hasAnswer);
  const hits = answerable.filter((r) =>
    rank(predsByUnit.get(r.unit) ?? [])
      .slice(0, k)
      .some((p) => isHit(r, p)),
  ).length;
  return ratio(hits, answerable.length);
}

/** Share of no-answer units correctly left without any counted edge. */
export function correctNoMatch(rows: KeyRow[], predsByUnit: Map<string, Prediction[]>): Ratio {
  const none = rows.filter((r) => !hasAnswer(r));
  const ok = none.filter((r) => !(predsByUnit.get(r.unit) ?? []).some((p) => p.counted)).length;
  return ratio(ok, none.length);
}

export function meanConfidenceOfTop1(
  rows: KeyRow[],
  predsByUnit: Map<string, Prediction[]>,
): number | null {
  const tops = rows.flatMap((r) => rank(predsByUnit.get(r.unit) ?? []).slice(0, 1));
  return tops.length === 0 ? null : tops.reduce((s, p) => s + p.confidence, 0) / tops.length;
}

/** The oracle for citation validity: stricter than the production fuzzy matcher on purpose. */
export const normalise = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
export const containsExactly = (source: string, quote: string): boolean =>
  normalise(quote).length > 0 && normalise(source).includes(normalise(quote));

export interface Metrics {
  accuracyAt1: Ratio;
  accuracyAt3: Ratio;
  noMatch: Ratio;
  /** Edges whose two evidence quotes both match their sources (production verifier). */
  quoteMatch: Ratio;
  /** Stored quote_verified agrees with what the code computes. */
  quoteFlagAgreement: Ratio;
  /** Citations SHOWN as verified that an independent exact check confirms. Target: 100%. */
  citationValidity: Ratio;
  /** Bad citations the system correctly marked unverified instead of showing them as fine. */
  badCitationsCaught: number;
  meanTop1Confidence: number | null;
}

export const THRESHOLDS = {
  /** Fails the build below this (starting value, tune with the eval). */
  minAccuracyAt1: 0.8,
  minQuoteFlagAgreement: 1,
  minCitationValidity: 1,
} as const;

/** Reasons the CI gate fails; empty when it passes. A metric with nothing to score fails. */
export function gateFailures(m: Metrics): string[] {
  const out: string[] = [];
  const need = (name: string, r: Ratio, min: number) => {
    if (r.rate === null) out.push(`${name}: nothing to score`);
    else if (r.rate < min) out.push(`${name}: ${pct(r.rate)} is below ${pct(min)}`);
  };
  need('citation validity', m.citationValidity, THRESHOLDS.minCitationValidity);
  need('quote flag agreement', m.quoteFlagAgreement, THRESHOLDS.minQuoteFlagAgreement);
  need('accuracy@1', m.accuracyAt1, THRESHOLDS.minAccuracyAt1);
  return out;
}

export const pct = (x: number | null): string => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
export const show = (r: Ratio): string => `${pct(r.rate)} (${r.hits}/${r.total})`;
