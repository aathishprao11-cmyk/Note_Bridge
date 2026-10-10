import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, type Collected } from './collect';
import { parseLabeled } from './csv';
import { renderReport } from './report';
import {
  accuracyAtK,
  correctNoMatch,
  gateFailures,
  meanConfidenceOfTop1,
  ratio,
  type Metrics,
} from './score';

/**
 * eval/run.ts (BRIEF 9.5): scores the seeded alignment against the hand-written key and writes
 * docs/EVAL.md. Exits 1 if the gate fails. Usage: `pnpm eval` (or `pnpm eval --no-write`).
 * Everything runs offline in mock mode; nothing here calls a model.
 */

export function computeMetrics(c: Collected): Metrics {
  const rows = parseLabeled(c.keyText);
  const quoteMatch = ratio(c.evidence.filter((e) => e.computedVerified).length, c.evidence.length);
  const agree = c.evidence.filter((e) => e.storedVerified === e.computedVerified).length;

  // Citation validity: of the citations shown as verified, how many an exact check confirms.
  const valid = c.shownVerified.filter((s) => s.exact && s.pageOk).length;

  return {
    accuracyAt1: accuracyAtK(rows, c.predsByUnit, 1),
    accuracyAt3: accuracyAtK(rows, c.predsByUnit, 3),
    noMatch: correctNoMatch(rows, c.predsByUnit),
    quoteMatch,
    quoteFlagAgreement: ratio(agree, c.evidence.length),
    citationValidity: ratio(valid, c.shownVerified.length),
    badCitationsCaught: c.caught,
    meanTop1Confidence: meanConfidenceOfTop1(rows, c.predsByUnit),
  };
}

async function main(): Promise<void> {
  const c = await collect();
  const m = computeMetrics(c);
  const failures = gateFailures(m);
  const report = renderReport(c, m, failures);
  if (!process.argv.includes('--no-write')) {
    const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'EVAL.md');
    writeFileSync(out, report, 'utf8');
    console.log(`[eval] wrote ${out}`);
  }
  console.log(
    report
      .split('\n')
      .filter((l) => l.startsWith('|'))
      .join('\n'),
  );
  if (failures.length > 0) {
    console.error(`[eval] GATE FAILED:\n  - ${failures.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('[eval] gate passed');
}

const invokedDirectly = process.argv[1] !== undefined && /run\.ts$/.test(process.argv[1]);
if (invokedDirectly) void main();
