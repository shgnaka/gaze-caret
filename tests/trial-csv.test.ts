import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trialsCsv } from '../src/core/trial-csv.ts';
import type { TrialRecord } from '../src/core/evaluation-report.ts';
import type { RunConfig } from '../src/core/runner.ts';

const header = '"sessionId","trialId","outcome","targetId","block","region","line","x","y","reason","contextId","modelId",' +
  '"schemaVersion","build","mode","fixture","seed","plannedTrials","blockSize","lineHeight","layoutRevision","targetX","targetY","targetText",' +
  '"candidateId","candidateBlock","candidateRegion","candidateLine","candidateX","candidateY","presentedAt","decidedAt","sampleCount","newestSampleAgeMs","oldestSampleAgeMs",' +
  '"madX","madY","windowStartAt","windowEndAt","viewportWidth","viewportHeight","viewportDpr","screenX","screenY","placementPosition","osScale","placementConfirmed"';
const config: RunConfig = { mode: 'camera', fixture: 'baseline', seed: 42, total: 60, blockSize: 20 };
const context = { sessionId: 'session-1', build: 'abc123', config };

function trial(): TrialRecord {
  return {
    id: 7,
    target: { id: 'word-1', block: 'p1', region: 'main', line: 4, x: 240, y: 400, text: '目標' },
    point: { x: 245, y: 410 },
    candidate: { id: 'line-p1-5', block: 'p1', region: 'main', line: 5, x: 230, y: 424, text: '' },
    presentedAt: 1000, decidedAt: 1650, outcome: 'adjacent', reason: null,
    environment: {
      contextId: 'context-2', modelId: 'model-3', lineHeight: 24, layoutRevision: 9,
      viewport: { width: 1280, height: 720, dpr: 1.25, screenX: 20, screenY: 30 },
      placement: { position: 'top', osScale: 125, confirmed: true },
    },
    decision: {
      pressedAt: 1650, contextId: 'context-2', modelId: 'model-3',
      point: { x: 245, y: 410 }, reason: null,
      window: { startAt: 1400, endAt: 1600 }, sampleCount: 3,
      newestSampleAgeMs: 75, oldestSampleAgeMs: 200, mad: { x: 2, y: 3 },
    },
  };
}

// Read the all-quoted CSV format without treating newlines inside fields as
// record separators. The sticky match also rejects an unquoted cell or gap.
function readCsv(csv: string): string[][] {
  assert.equal(csv[0], '\ufeff');
  const rows: string[][] = [[]];
  const cell = /"((?:""|[^"])*)"(?:(,)|(\r\n)|$)/gy;
  let at = 1;
  while (at < csv.length) {
    cell.lastIndex = at;
    const match = cell.exec(csv);
    assert.ok(match, `Invalid quoted CSV at ${at}`);
    rows.at(-1)!.push(match[1]!.replaceAll('""', '"'));
    at = cell.lastIndex;
    if (match[3]) rows.push([]);
  }
  return rows;
}

test('EVAL-04: CSV retains the legacy columns and a complete independent trial record', () => {
  const expectedRow = '"session-1","7","adjacent","word-1","p1","main","4","245","410","","context-2","model-3",' +
    '"2","abc123","camera","baseline","42","60","20","24","9","240","400","目標",' +
    '"line-p1-5","p1","main","5","230","424","1000","1650","3","75","200",' +
    '"2","3","1400","1600","1280","720","1.25","20","30","top","125","true"';
  assert.equal(trialsCsv(context, [trial()]), '\ufeff' + header + '\r\n' + expectedRow);
});

test('EVAL-04: CSV distinguishes zero and false from absent measurements', () => {
  const zero = trial();
  zero.id = 1; zero.outcome = 'unavailable'; zero.reason = null;
  zero.target = { id: '', block: '', region: '', line: 0, x: 0, y: 0, text: '' };
  zero.point = { x: 0, y: 0 }; zero.candidate = null;
  zero.presentedAt = 0; zero.decidedAt = 500;
  zero.environment = {
    contextId: '', modelId: '', lineHeight: 0, layoutRevision: 0,
    viewport: { width: 0, height: 0, dpr: 0, screenX: 0, screenY: 0 },
    placement: { position: '', osScale: null, confirmed: false },
  };
  zero.decision = {
    pressedAt: 500, contextId: '', modelId: '', point: null, reason: 'insufficient-samples',
    window: { startAt: 0, endAt: 0 }, sampleCount: 0,
    newestSampleAgeMs: null, oldestSampleAgeMs: null, mad: null,
  };
  const absent = { ...zero, id: 2, point: null, environment: null, decision: null };
  const csv = trialsCsv({ sessionId: '', build: '', config: { mode: 'demo', fixture: '', seed: 0, total: 1, blockSize: 1 } }, [zero, absent]);
  assert.deepEqual(readCsv(csv).slice(1), [
    ['', '1', 'unavailable', '', '', '', '0', '0', '0', '', '', '',
      '2', '', 'demo', '', '0', '1', '1', '0', '0', '0', '0', '',
      '', '', '', '', '', '', '0', '500', '0', '', '', '', '', '0', '0', '0', '0', '0', '0', '0', '', '', 'false'],
    ['', '2', 'unavailable', '', '', '', '0', '', '', '', '', '',
      '2', '', 'demo', '', '0', '1', '1', '', '', '0', '0', '',
      '', '', '', '', '', '', '0', '500', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ]);
});

test('EVAL-04: quoted Japanese text, commas and embedded newlines survive CSV export', () => {
  const record = trial();
  record.target.text = '日本語の"目標"\n次の行';
  record.reason = '候補 "なし",\r\nもう一度';
  const csv = trialsCsv({ ...context, sessionId: '実験,1', build: 'build"2' }, [record]);
  assert.equal(csv.includes('"日本語の""目標""\n次の行"'), true);
  assert.equal(csv.includes('"候補 ""なし"",\r\nもう一度"'), true);
  assert.deepEqual(readCsv(csv).slice(1), [[
    '実験,1', '7', 'adjacent', 'word-1', 'p1', 'main', '4', '245', '410', '候補 "なし",\r\nもう一度', 'context-2', 'model-3',
    '2', 'build"2', 'camera', 'baseline', '42', '60', '20', '24', '9', '240', '400', '日本語の"目標"\n次の行',
    'line-p1-5', 'p1', 'main', '5', '230', '424', '1000', '1650', '3', '75', '200',
    '2', '3', '1400', '1600', '1280', '720', '1.25', '20', '30', 'top', '125', 'true',
  ]]);
});

test('EVAL-04: an empty trial cohort exports a header without inventing a trial', () => {
  assert.equal(trialsCsv(context, []), '\ufeff' + header);
});

test('CSV export leaves the run context and nested trial records unchanged', () => {
  function freeze<T>(value: T): T {
    if (value && typeof value === 'object') {
      Object.freeze(value);
      Object.values(value).forEach(freeze);
    }
    return value;
  }
  const input = freeze({ context: structuredClone(context), trials: [trial()] });
  const before = structuredClone(input);
  trialsCsv(input.context, input.trials);
  assert.deepEqual(input, before);
});
