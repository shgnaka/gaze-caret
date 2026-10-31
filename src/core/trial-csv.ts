import { RUN_REPORT_SCHEMA_VERSION } from './evaluation-report.ts';
import type { TrialRecord } from './evaluation-report.ts';
import type { RunConfig } from './runner.ts';

const COLUMNS = [
  'sessionId', 'trialId', 'outcome', 'targetId', 'block', 'region', 'line', 'x', 'y', 'reason', 'contextId', 'modelId',
  'schemaVersion', 'build', 'mode', 'fixture', 'seed', 'plannedTrials', 'blockSize', 'lineHeight', 'layoutRevision', 'targetX', 'targetY', 'targetText',
  'candidateId', 'candidateBlock', 'candidateRegion', 'candidateLine', 'candidateX', 'candidateY', 'presentedAt', 'decidedAt', 'sampleCount', 'newestSampleAgeMs', 'oldestSampleAgeMs',
  'madX', 'madY', 'windowStartAt', 'windowEndAt', 'viewportWidth', 'viewportHeight', 'viewportDpr', 'screenX', 'screenY', 'placementPosition', 'osScale', 'placementConfirmed',
] as const;

function quoted(value: string | number | boolean | null | undefined): string {
  return '"' + String(value ?? '').replaceAll('"', '""') + '"';
}

export function trialsCsv(
  context: { sessionId: string; build: string; config: Readonly<RunConfig> },
  trials: readonly TrialRecord[],
): string {
  const { config } = context;
  const rows = trials.map(trial => {
    const { environment, decision, candidate, target, point } = trial;
    return [
      context.sessionId, trial.id, trial.outcome, target.id, target.block, target.region, target.line, point?.x, point?.y, trial.reason, environment?.contextId, environment?.modelId,
      RUN_REPORT_SCHEMA_VERSION, context.build, config.mode, config.fixture, config.seed, config.total, config.blockSize, environment?.lineHeight, environment?.layoutRevision, target.x, target.y, target.text,
      candidate?.id, candidate?.block, candidate?.region, candidate?.line, candidate?.x, candidate?.y, trial.presentedAt, trial.decidedAt, decision?.sampleCount, decision?.newestSampleAgeMs, decision?.oldestSampleAgeMs,
      decision?.mad?.x, decision?.mad?.y, decision?.window.startAt, decision?.window.endAt, environment?.viewport.width, environment?.viewport.height, environment?.viewport.dpr, environment?.viewport.screenX, environment?.viewport.screenY,
      environment?.placement.position, environment?.placement.osScale, environment?.placement.confirmed,
    ];
  });
  return '\ufeff' + [COLUMNS, ...rows].map(row => row.map(quoted).join(',')).join('\r\n');
}
