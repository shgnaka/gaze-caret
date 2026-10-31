import type { Trial } from './runner.ts';
import type { GazeDecision } from './select-gaze-point.ts';
import { summarizeTrials } from './evaluation.ts';
import type { EvaluationSummary } from './evaluation.ts';

export const RUN_REPORT_SCHEMA_VERSION = 2;
export const EVALUATION_SCHEMA_VERSION = 1;

export interface TrialEnvironment {
  contextId: string;
  modelId: string;
  layoutRevision: number;
  viewport: { width: number; height: number; dpr: number; screenX: number; screenY: number };
  placement: { position: string; osScale: number | null; confirmed: boolean };
  lineHeight: number;
}

export interface TrialRecord extends Trial {
  environment: TrialEnvironment | null;
  decision: GazeDecision | null;
}

export interface ConditionSummary {
  id: number;
  environment: TrialEnvironment | null;
  trialIds: number[];
  summary: EvaluationSummary;
}

export interface ConditionEvaluation {
  schemaVersion: typeof EVALUATION_SCHEMA_VERSION;
  total: number;
  outcomes: EvaluationSummary['outcomes'];
  exactOrAdjacent: EvaluationSummary['exactOrAdjacent'];
  mixedConditions: boolean;
  hasUnknownEnvironment: boolean;
  conditions: ConditionSummary[];
}

function copyEnvironment(environment: TrialEnvironment): TrialEnvironment {
  return { ...environment, viewport: { ...environment.viewport }, placement: { ...environment.placement } };
}

function conditionKey(environment: TrialEnvironment | null): string {
  if (!environment) return 'unknown';
  const { contextId, modelId, layoutRevision, lineHeight, viewport, placement } = environment;
  return JSON.stringify([
    contextId, modelId, layoutRevision, lineHeight,
    viewport.width, viewport.height, viewport.dpr, viewport.screenX, viewport.screenY,
    placement.position, placement.osScale, placement.confirmed,
  ]);
}

export function createTrialRecords(
  trials: readonly Trial[],
  environments: Readonly<Record<number, TrialEnvironment>>,
  decisions: Readonly<Record<number, GazeDecision>>,
): TrialRecord[] {
  return trials.map(trial => {
    const environment = environments[trial.id], decision = decisions[trial.id];
    return {
      ...trial,
      target: { ...trial.target },
      point: trial.point ? { ...trial.point } : null,
      candidate: trial.candidate ? { ...trial.candidate } : null,
      environment: environment ? copyEnvironment(environment) : null,
      decision: decision ? {
        ...decision, window: { ...decision.window },
        point: decision.point ? { ...decision.point } : null,
        mad: decision.mad ? { ...decision.mad } : null,
      } : null,
    };
  });
}

export function summarizeConditions(trials: readonly TrialRecord[]): ConditionEvaluation {
  const summary = summarizeTrials(trials);
  const groups = new Map<string, TrialRecord[]>();
  for (const trial of trials) {
    const key = conditionKey(trial.environment);
    const group = groups.get(key);
    if (group) group.push(trial); else groups.set(key, [trial]);
  }
  const conditions = [...groups.values()].map((group, index): ConditionSummary => ({
    id: index + 1,
    environment: group[0]!.environment ? copyEnvironment(group[0]!.environment) : null,
    trialIds: group.map(trial => trial.id), summary: summarizeTrials(group),
  }));
  return {
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    total: summary.total, outcomes: summary.outcomes, exactOrAdjacent: summary.exactOrAdjacent,
    mixedConditions: groups.size > 1, hasUnknownEnvironment: groups.has('unknown'), conditions,
  };
}

export function conditionSummaryText(evaluation: ConditionEvaluation): string {
  return `Evaluation schema: ${evaluation.schemaVersion}\nConditions: ${evaluation.conditions.length}\nMixed conditions: ${evaluation.mixedConditions ? 'yes' : 'no'}\nUnknown environment: ${evaluation.hasUnknownEnvironment ? 'yes' : 'no'}`;
}
