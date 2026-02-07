# MOB-264 CI Runner Migration Evidence

This document records the auditable evidence for MOB-264 acceptance criteria: workflow scope decisions, tubular core parity implementation notes, and measured CI runtime outcomes.

## Workflow Inventory

| Workflow file | Disposition | Rationale |
| --- | --- | --- |
| `.github/workflows/ci.yml` | migrate now | Non-release validation workflow (build/test/clippy) is in-scope for self-hosted migration. |
| `.github/workflows/build-rust.yml` | out of scope | Release artifact workflow invoked by release pipeline; explicitly excluded by task scope. |
| `.github/workflows/release-please.yml` | out of scope | Release orchestration workflow; explicitly excluded from migration edits. |

## Tubular Core Parity Notes

`ci.yml` now matches tubular core execution expectations for non-release CI jobs:

- Runner selection is self-hosted only (`self-hosted`, `linux`, `x64`) with no hosted fallback path.
- Job runtime executes in `ghcr.io/tubular-health/tubular-ci:latest` with `GITHUB_TOKEN` credentials.
- Cargo registry cache parity uses mounted volume `/home/runner/.cargo-cache:/opt/cargo/registry` instead of `actions/cache`.
- Fail-fast behavior is explicit through job `timeout-minutes: 20` and per-ref `concurrency` cancellation.
- Top-level permissions are minimal and explicit (`contents: read`, `packages: read`).

## Runtime Benchmark Evidence

Benchmarks were generated with `scripts/ci-runtime-benchmark.sh` using equivalent event classes and equal sample windows for baseline/post comparison.

### Commands Used

```bash
scripts/ci-runtime-benchmark.sh --workflow .github/workflows/ci.yml --event push --baseline-limit 8 --post-limit 8 --format json
scripts/ci-runtime-benchmark.sh --workflow .github/workflows/ci.yml --event pull_request --baseline-limit 8 --post-limit 8 --format json
```

### Results

| Event class | Baseline median | Post-migration median | Improvement | Baseline sample | Post sample |
| --- | --- | --- | --- | --- | --- |
| `push` | 178.5s | 50s | 71.99% | 8 runs | 8 runs |
| `pull_request` | 155s | 61s | 60.65% | 8 runs | 8 runs |

Both event classes exceed the 25% runtime-improvement target.

### Run References (Audit Trail)

- Push baseline example run: `21636601738` (`https://github.com/Tubular-Health/mobius/actions/runs/21636601738`)
- Push post-migration example run: `21784975787` (`https://github.com/Tubular-Health/mobius/actions/runs/21784975787`)
- Pull request baseline example run: `21636090690` (`https://github.com/Tubular-Health/mobius/actions/runs/21636090690`)
- Pull request post-migration example run: `21776543247` (`https://github.com/Tubular-Health/mobius/actions/runs/21776543247`)

## Acceptance Criteria Mapping

| Parent acceptance criterion | Evidence |
| --- | --- |
| Migrate non-release CI workflows to self-hosted runners with tubular core parity | Workflow Inventory marks `ci.yml` as `migrate now`; parity details documented in Tubular Core Parity Notes; implementation visible in `.github/workflows/ci.yml`. |
| Keep release workflows out of migration scope | Workflow Inventory marks `build-rust.yml` and `release-please.yml` as `out of scope` with release rationale; no migration requirement attached to those files. |
| Demonstrate >=25% CI runtime improvement with measurable evidence | Runtime Benchmark Evidence includes command snippets, baseline/post medians, percentage deltas, and run IDs/URLs for auditability. |

## Evidence Snapshot

- Measurement date: 2026-02-07
- Benchmark tool: `scripts/ci-runtime-benchmark.sh`
- Data source: `gh run list` for `.github/workflows/ci.yml` filtered by event class
