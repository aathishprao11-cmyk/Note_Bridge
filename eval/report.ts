import type { Collected } from './collect';
import { parseLabeled } from './csv';
import { THRESHOLDS, pct, ratio, show, type Metrics } from './score';

/** Renders docs/EVAL.md. Wording is deliberately blunt about what the numbers do and do not mean. */
export function renderReport(c: Collected, m: Metrics, failures: string[]): string {
  const abst = ratio(c.unanswerable.filter((u) => u.abstained).length, c.unanswerable.length);
  const rows = parseLabeled(c.keyText);
  const missed = rows
    .filter((r) => r.book !== '')
    .filter((r) => (c.predsByUnit.get(r.unit) ?? []).length === 0)
    .map((r) => r.unit);
  const gate = failures.length === 0 ? 'PASS' : 'FAIL';
  const lines = [
    '# Evaluation',
    '',
    `Gate: **${gate}**${failures.map((f) => `\n- ${f}`).join('')}`,
    '',
    '> **Read this first.** These numbers score the **seeded demo course** (hand-written fixtures,',
    '> 12 lecture units, 1 synthetic book) against a **hand-written key** (`eval/labeled.csv`).',
    '> The alignment engine that produces edges from uploaded files is **not built yet**, so this',
    '> measures the wiring and grounding rules, **not model quality**. The key was written by the',
    '> same people who wrote the fixtures, so accuracy here is optimistic and will drop on real',
    '> data. `pnpm eval` regenerates this file; do not edit it by hand.',
    '',
    '| Metric | Result | Notes |',
    '| --- | --- | --- |',
    `| Alignment accuracy@1 | ${show(m.accuracyAt1)} | answerable units whose top edge is the right book and page range (gate: >= ${pct(THRESHOLDS.minAccuracyAt1)}) |`,
    `| Alignment accuracy@3 | ${show(m.accuracyAt3)} | right passage within the top 3 edges |`,
    `| Correct "no match" | ${show(m.noMatch)} | units with no book answer that have no counted edge (professor_only) |`,
    `| Quote-match rate | ${show(m.quoteMatch)} | edges whose two evidence quotes match their sources at >= 90% |`,
    `| Quote flag agreement | ${show(m.quoteFlagAgreement)} | stored \`quote_verified\` equals what code recomputes (gate: 100%) |`,
    `| Citation validity | ${show(m.citationValidity)} | citations shown as verified that an exact, independent check confirms, incl. printed page (gate: 100%) |`,
    `| Bad citations caught | ${m.badCitationsCaught} | citations the validator marked unverified instead of showing them as fine |`,
    `| Correct abstention | ${show(abst)} | off-topic questions answered "not found" |`,
    `| Mean top-1 confidence | ${pct(m.meanTop1Confidence)} | computed confidence of each unit's best edge |`,
    '',
    `Chat check: ${c.answerableAsked - c.answerableAbstained}/${c.answerableAsked} answerable questions got an answer (the rest abstained).`,
    missed.length > 0 ? `\nUnits with no edge but a key answer: ${missed.join(', ')}.` : '',
    '',
    '## Not measured',
    '',
    '- **retrieval recall@8**: retrieval is not implemented (it always abstains), so there is nothing to measure.',
    '- **calibration** (confidence buckets vs accuracy): 16 fixture edges with hand-set confidences would make the buckets noise.',
    '- **Problem Finder precision@5**: Problem Finder is not built.',
    '- **Real-data accuracy**: needs live ingestion to alignment, which does not exist yet.',
    '',
    '## How the gate works',
    '',
    `CI fails if citation validity < ${pct(THRESHOLDS.minCitationValidity)}, quote flag agreement < ${pct(THRESHOLDS.minQuoteFlagAgreement)}, or accuracy@1 < ${pct(THRESHOLDS.minAccuracyAt1)}. A metric with nothing to score fails rather than passing silently. Thresholds live in \`eval/score.ts\` and are starting values.`,
    '',
    '## Files',
    '',
    '- `eval/labeled.csv`: unit, correct book, correct printed pages (empty = no answer in the books).',
    '- `eval/unanswerable.csv`: questions the material cannot answer.',
    '- `eval/score.ts`, `eval/csv.ts`, `eval/collect.ts`, `eval/report.ts`, `eval/run.ts`: scoring, parsing, data collection, report, runner.',
    '',
  ];
  return lines.join('\n');
}
