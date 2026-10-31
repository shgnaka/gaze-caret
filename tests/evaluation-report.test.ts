import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTrialRecords, summarizeConditions, conditionSummaryText, RUN_REPORT_SCHEMA_VERSION } from '../src/core/evaluation-report.ts';
import type { TrialEnvironment, TrialRecord } from '../src/core/evaluation-report.ts';
import type { Trial } from '../src/core/runner.ts';
import type { GazeDecision } from '../src/core/select-gaze-point.ts';

const environment: TrialEnvironment = {
  contextId: 'viewport-1', modelId: 'model-1', layoutRevision: 1, lineHeight: 24,
  viewport: { width: 1200, height: 900, dpr: 1, screenX: 0, screenY: 0 },
  placement: { position: 'top', osScale: 100, confirmed: true },
};
function trial(id: number): Trial {
  const target = { id: 'word-1', x: 0, y: 0, block: 'p1', region: 'main', line: 0, text: '言葉' };
  return { id, target, point: { x: 3, y: 4 }, candidate: { ...target, id: 'line-p1-0' },
    presentedAt: 0, decidedAt: 600, outcome: 'exact', reason: null };
}
function record(id: number, conditions: TrialEnvironment | null = environment): TrialRecord {
  return { ...trial(id), environment: conditions ? structuredClone(conditions) : null, decision: null };
}

test('a report snapshots trial, environment and selection evidence independently', () => {
  const source = trial(1), metadata = { 1: structuredClone(environment) };
  const decision = {
    pressedAt: 600, contextId: 'viewport-1', modelId: 'model-1',
    window: { startAt: 350, endAt: 550 }, sampleCount: 3,
    newestSampleAgeMs: 70, oldestSampleAgeMs: 200, mad: { x: 0, y: 0 },
    point: { x: 3, y: 4 }, reason: null,
  } satisfies GazeDecision;
  const records = createTrialRecords([source], metadata, { 1: decision });
  const snapshot = JSON.stringify(records);
  source.target.text = 'changed'; source.point = null; source.candidate!.line = 2;
  metadata[1].viewport.width = 800; metadata[1].placement.position = 'bottom';
  decision.window.startAt = 0; decision.mad!.x = 40;
  assert.equal(JSON.stringify(records), snapshot);
  assert.equal(RUN_REPORT_SCHEMA_VERSION, 2);
});

test('begin-time model and viewport cohorts retain failures and unassigned trials', () => {
  const first = record(1), second = record(2), third = record(3), unknown = record(4, null);
  second.outcome = 'unavailable'; second.point = null; second.candidate = null;
  third.environment!.modelId = 'model-2'; third.point = { x: 30, y: 40 };
  unknown.outcome = 'aborted'; unknown.point = null; unknown.candidate = null;
  const summary = summarizeConditions([first, second, third, unknown]);
  assert.equal(summary.total, 4);
  assert.deepEqual(summary.outcomes.exact, { count: 2, rate: .5 });
  assert.equal(summary.mixedConditions, true);
  assert.equal(summary.hasUnknownEnvironment, true);
  assert.deepEqual(summary.conditions.map(c => c.trialIds), [[1, 2], [3], [4]]);
  assert.deepEqual(summary.conditions.map(c => c.summary.total), [2, 1, 1]);
  assert.deepEqual(summary.conditions.map(c => c.summary.coordinateError.euclidean.p50), [5, 50, null]);
  assert.equal(summary.conditions[0]!.summary.coordinateError.missingCount, 1);
  assert.equal(summary.conditions[2]!.summary.outcomes.aborted.rate, 1);
  // A report gives pooled outcome counts, but never a pooled coordinate-error percentile.
  assert.equal('coordinateError' in summary, false);
});

test('each recorded display or placement condition partitions its own cohort', () => {
  const changes: ((e: TrialEnvironment) => void)[] = [
    e => { e.contextId = 'viewport-2'; }, e => { e.modelId = 'model-2'; },
    e => { e.layoutRevision++; }, e => { e.lineHeight = 32; },
    e => { e.viewport.width++; }, e => { e.viewport.height++; },
    e => { e.viewport.dpr = 2; }, e => { e.viewport.screenX++; }, e => { e.viewport.screenY++; },
    e => { e.placement.position = 'left'; }, e => { e.placement.osScale = null; },
    e => { e.placement.confirmed = false; },
  ];
  for (const change of changes) {
    const other = record(2); change(other.environment!);
    const result = summarizeConditions([record(1), other]);
    assert.equal(result.conditions.length, 2);
    assert.equal(result.mixedConditions, true);
  }
});

test('equivalent metadata property order does not create another condition', () => {
  const other = record(2);
  other.environment!.viewport = { screenY: 0, screenX: 0, dpr: 1, height: 900, width: 1200 };
  other.environment!.placement = { confirmed: true, osScale: 100, position: 'top' };
  const result = summarizeConditions([record(1), other]);
  assert.equal(result.conditions.length, 1);
  assert.equal(result.mixedConditions, false);
  assert.equal(result.hasUnknownEnvironment, false);
});

test('missing metadata stays explicit and empty rates stay null', () => {
  const records = createTrialRecords([trial(1)], {}, {});
  assert.equal(records[0]!.environment, null);
  assert.equal(records[0]!.decision, null);
  const unknown = summarizeConditions(records);
  assert.equal(unknown.hasUnknownEnvironment, true);
  assert.equal(unknown.conditions[0]!.environment, null);
  const empty = summarizeConditions([]);
  assert.equal(empty.total, 0);
  assert.equal(empty.outcomes.exact.rate, null);
  assert.deepEqual(empty.conditions, []);
  assert.equal(empty.mixedConditions, false);
  assert.equal(empty.hasUnknownEnvironment, false);
});

test('condition summaries do not retain aliases to caller metadata', () => {
  const input = record(1), result = summarizeConditions([input]);
  input.environment!.viewport.width = 800;
  input.environment!.placement.position = 'left';
  assert.equal(result.conditions[0]!.environment!.viewport.width, 1200);
  assert.equal(result.conditions[0]!.environment!.placement.position, 'top');
});

test('shared summaries disclose condition mixing without exporting individual coordinates or identities', () => {
  const second = record(2); second.environment!.modelId = 'model-2';
  const mixed = conditionSummaryText(summarizeConditions([record(1), second, record(3, null)]));
  assert.match(mixed, /Evaluation schema: 1/);
  assert.match(mixed, /Conditions: 3/);
  assert.match(mixed, /Mixed conditions: yes/);
  assert.match(mixed, /Unknown environment: yes/);
  assert.doesNotMatch(mixed, /model-1|model-2|viewport-1|word-1|coordinate|1200/);
  const empty = conditionSummaryText(summarizeConditions([]));
  assert.match(empty, /Conditions: 0/);
  assert.match(empty, /Mixed conditions: no/);
  assert.match(empty, /Unknown environment: no/);
});
