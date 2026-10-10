# Evaluation

Gate: **PASS**

> **Read this first.** These numbers score the **seeded demo course** (hand-written fixtures,
> 12 lecture units, 1 synthetic book) against a **hand-written key** (`eval/labeled.csv`).
> The alignment engine that produces edges from uploaded files is **not built yet**, so this
> measures the wiring and grounding rules, **not model quality**. The key was written by the
> same people who wrote the fixtures, so accuracy here is optimistic and will drop on real
> data. `pnpm eval` regenerates this file; do not edit it by hand.

| Metric | Result | Notes |
| --- | --- | --- |
| Alignment accuracy@1 | 100.0% (10/10) | answerable units whose top edge is the right book and page range (gate: >= 80.0%) |
| Alignment accuracy@3 | 100.0% (10/10) | right passage within the top 3 edges |
| Correct "no match" | 100.0% (2/2) | units with no book answer that have no counted edge (professor_only) |
| Quote-match rate | 87.5% (14/16) | edges whose two evidence quotes match their sources at >= 90% |
| Quote flag agreement | 100.0% (16/16) | stored `quote_verified` equals what code recomputes (gate: 100%) |
| Citation validity | 100.0% (5/5) | citations shown as verified that an exact, independent check confirms, incl. printed page (gate: 100%) |
| Bad citations caught | 0 | citations the validator marked unverified instead of showing them as fine |
| Correct abstention | 100.0% (5/5) | off-topic questions answered "not found" |
| Mean top-1 confidence | 77.8% | computed confidence of each unit's best edge |

Chat check: 3/3 answerable questions got an answer (the rest abstained).


## Not measured

- **retrieval recall@8**: retrieval is not implemented (it always abstains), so there is nothing to measure.
- **calibration** (confidence buckets vs accuracy): 16 fixture edges with hand-set confidences would make the buckets noise.
- **Problem Finder precision@5**: Problem Finder is not built.
- **Real-data accuracy**: needs live ingestion to alignment, which does not exist yet.

## How the gate works

CI fails if citation validity < 100.0%, quote flag agreement < 100.0%, or accuracy@1 < 80.0%. A metric with nothing to score fails rather than passing silently. Thresholds live in `eval/score.ts` and are starting values.

## Files

- `eval/labeled.csv`: unit, correct book, correct printed pages (empty = no answer in the books).
- `eval/unanswerable.csv`: questions the material cannot answer.
- `eval/score.ts`, `eval/csv.ts`, `eval/collect.ts`, `eval/report.ts`, `eval/run.ts`: scoring, parsing, data collection, report, runner.
