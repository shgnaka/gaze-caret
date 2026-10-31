import { test, expect } from './harness.ts';
import type { Page } from '@playwright/test';
async function startDemo(page: Page, fixture='baseline'): Promise<void> {
  await page.goto('/'); await page.locator('#mode').selectOption('demo'); await page.locator('#fixture-choice').selectOption(fixture); await page.locator('#start').click();
  await page.locator('#placement-confirm').check(); await page.locator('#calibrate').click();
}
async function validation(page:Page):Promise<void> {
  for(let i=0;i<5;i++){
    await expect(page.locator('#overlay-progress')).toContainText(`精度確認 ${i+1} / 5`);
    const box=await page.locator('#aim-marker').boundingBox();if(!box)throw new Error('Missing target');
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.waitForTimeout(650);await page.keyboard.press('Space');
    if(i<4)await expect(page.locator('#overlay-progress')).toContainText(`精度確認 ${i+2} / 5`);
  }
  await expect(page.locator('#accept-validation')).toBeEnabled();await page.locator('#accept-validation').click();
}
async function trial(page:Page):Promise<void> {
  try { await expect(page.locator('[data-current]')).toHaveCount(1); } catch (error) { throw new Error(await page.locator('body').innerText(), { cause: error }); }
  const box=await page.locator('[data-current]').boundingBox();if(!box)throw new Error('Missing word');
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.waitForTimeout(650);await page.keyboard.press('Space');
  await expect(page.locator('#trial-prompt')).toHaveText('正しい行');await page.waitForTimeout(850);
}
test('demo can start without requesting a camera and reaches calibration instructions', async ({ page }) => {
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new Error('Camera must not be requested in demo'); }; });
  await page.goto('/'); await page.locator('#mode').selectOption('demo'); await page.locator('#start').click();
  await expect(page.locator('#stage-title')).toHaveText('配置と写り方を確認');
  await expect(page.locator('#demo-banner')).toBeVisible();
  await page.locator('#placement-confirm').check(); await page.locator('#calibrate').click();
  await expect(page.locator('#stage-title')).toHaveText('精度を確認');
});

test('detailed diagnostics can be downloaded before calibration starts', async ({ page }) => {
  await page.goto('/');
  await page.locator('#mode').selectOption('demo');
  await page.locator('#diagnostic-mode').selectOption('detailed');
  await page.locator('#start').click();
  await expect(page.locator('#stage-title')).toHaveText('配置と写り方を確認');
  const download = page.waitForEvent('download');
  await page.locator('#download-diagnostics').click();
  const artifact = await download;
  const path = await artifact.path();
  const result = JSON.parse(await Deno.readTextFile(path!));
  expect(result.experiment).toBe('gaze-caret-diagnostics-v1');
  expect(result.diagnostics.mode).toBe('detailed');
  expect(result.diagnostics).toHaveProperty('frames');
  expect(result).not.toHaveProperty('audio');
  expect(result).not.toHaveProperty('video');
});
test('complete a demo with a break, preserve failures, and share only after explicit consent', 90000, async({page})=>{
  const offsite:string[]=[];page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4173'))offsite.push(r.url());});
  await startDemo(page);await validation(page);
  for(let i=0;i<3;i++)await trial(page);
  await page.locator('#formal').click();
  for(let i=0;i<6;i++)await trial(page);
  await expect(page.locator('#stage-title')).toHaveText('ひと休み');
  await page.locator('#resume-validation').click();await validation(page);
  for(let i=0;i<6;i++)await trial(page);
  await expect(page.locator('#stage-title')).toHaveText('結果とフィードバック');
  await expect(page.locator('#share')).not.toHaveAttribute('href',/.+/);
  await page.locator('#feedback').fill('操作できました。');
  await expect(page.locator('#share-preview')).toHaveValue(/DEMO[\s\S]*exact: 12[\s\S]*操作できました。/);
  await expect(page.locator('#share-preview')).toHaveValue(/Conditions: 1[\s\S]*Mixed conditions: no/);
  await page.locator('#share-consent').check();
  const href=await page.locator('#share').getAttribute('href');expect(new URL(href!).searchParams.get('body')).toContain('exact: 12');
  const download=page.waitForEvent('download');await page.locator('#json').click();
  const artifact=await download;expect(artifact.suggestedFilename()).toMatch(/gaze-caret-.+\.json$/);
  const result=JSON.parse(await Deno.readTextFile((await artifact.path())!));
  expect(result.schemaVersion).toBe(2);expect(result.experiment).toBe('gaze-caret-runner-v2');
  expect(result.trials).toHaveLength(12);expect(result.practiceTrials).toHaveLength(3);
  expect(result.evaluation.total).toBe(12);expect(result.evaluation.schemaVersion).toBe(1);
  expect(result.evaluation.outcomes.exact).toEqual({count:12,rate:1});
  expect(result.evaluation.conditions).toHaveLength(1);
  expect(result.evaluation.conditions[0].summary.total).toBe(12);
  expect(result.evaluation.conditions[0].summary.coordinateError.validCount).toBe(12);
  for(const recorded of result.trials){
    expect(recorded.candidate).toMatchObject({block:recorded.target.block,region:recorded.target.region,line:recorded.target.line});
    expect(recorded.decision.point).toEqual(recorded.point);
  }
  const csvDownload=page.waitForEvent('download');await page.locator('#csv').click();
  const csvArtifact=await csvDownload;const csv=new TextDecoder('utf-8',{ignoreBOM:true}).decode(await Deno.readFile((await csvArtifact.path())!));
  expect(csv.startsWith('\ufeff')).toBe(true);
  // This controlled fixture has no quotes or line breaks in its word/reason cells.
  // General CSV escaping is covered by the pure exporter tests.
  const csvRows=csv.slice(1).split('\r\n').map(row=>row.slice(1,-1).split('","'));
  const csvHeader=csvRows[0]!;
  expect(csvHeader.slice(0,12)).toEqual(['sessionId','trialId','outcome','targetId','block','region','line','x','y','reason','contextId','modelId']);
  expect(csvRows.slice(1)).toHaveLength(12);
  result.trials.forEach((recorded: {candidate:{line:number};target:{x:number};environment:{modelId:string}},index:number)=>{
    const row=Object.fromEntries(csvHeader.map((key,column)=>[key,csvRows[index+1]![column]]));
    expect(row.schemaVersion).toBe('2');expect(row.targetX).toBe(String(recorded.target.x));
    expect(row.candidateLine).toBe(String(recorded.candidate.line));expect(row.modelId).toBe(recorded.environment.modelId);
  });
  expect(offsite).toEqual([]);
});
test('camera is opt-in, video-only, and denial is recoverable',async({page})=>{
  await page.addInitScript(()=>{
    (window as unknown as {mediaRequests:MediaStreamConstraints[]}).mediaRequests=[];
    navigator.mediaDevices.getUserMedia=async constraints=>{(window as unknown as {mediaRequests:MediaStreamConstraints[]}).mediaRequests.push(constraints??{});throw new DOMException('Denied','NotAllowedError');};
  });
  await page.goto('/');expect(await page.evaluate(()=>(window as unknown as {mediaRequests:MediaStreamConstraints[]}).mediaRequests)).toEqual([]);
  await page.locator('#start').click();await expect(page.locator('#status')).toContainText('カメラが許可されていません');
  expect(await page.evaluate(()=>(window as unknown as {mediaRequests:MediaStreamConstraints[]}).mediaRequests[0]!.audio)).toBe(false);
  await expect(page.getByRole('button',{name:'再試行',exact:true})).toBeVisible();
});
test('resize during a trial records an abort and prevents a stale selection',45000,async({page})=>{
  await startDemo(page);await validation(page);for(let i=0;i<3;i++)await trial(page);await page.locator('#formal').click();
  await page.setViewportSize({width:1200,height:900});await expect(page.locator('#stage-title')).toHaveText('一時停止しました');
  await page.keyboard.press('Space');await page.locator('#finish').click();
  await expect(page.locator('#share-preview')).toHaveValue(/Started: 1[\s\S]*aborted: 1/);
  const download=page.waitForEvent('download');await page.locator('#json').click();
  const result=JSON.parse(await Deno.readTextFile((await (await download).path())!));
  expect(result.trials[0].candidate).toBe(null);
  expect(result.trials[0].environment.modelId).toBe('demo-pointer');
  expect(result.trials[0].environment.viewport.width).toBe(1280);
  expect(result.evaluation.outcomes.aborted).toEqual({count:1,rate:1});
  expect(result.evaluation.conditions[0].summary.coordinateError.missingCount).toBe(1);
});

test('resuming after a viewport change keeps model cohorts separate in results and shared text',45000,async({page})=>{
  await startDemo(page);await validation(page);for(let i=0;i<3;i++)await trial(page);
  await page.locator('#formal').click();await page.setViewportSize({width:1200,height:900});
  await expect(page.locator('#stage-title')).toHaveText('一時停止しました');
  await page.locator('#resume').click();await page.locator('#placement-confirm').check();await page.locator('#calibrate').click();
  await validation(page);
  const target=await page.locator('[data-current]').boundingBox();if(!target)throw new Error('Missing resumed target');
  await page.mouse.move(target.x+target.width/2,target.y+target.height/2);
  await page.waitForTimeout(650);await page.keyboard.press('Space');
  await expect(page.locator('#trial-prompt')).toHaveText('正しい行');await page.locator('#finish').click();
  await expect(page.locator('#share-preview')).toHaveValue(/Conditions: 2[\s\S]*Mixed conditions: yes[\s\S]*Started: 2/);
  const download=page.waitForEvent('download');await page.locator('#json').click();
  const result=JSON.parse(await Deno.readTextFile((await (await download).path())!));
  expect(result.evaluation.total).toBe(2);expect(result.evaluation.conditions).toHaveLength(2);
  expect(result.evaluation.conditions.map((condition:{summary:{total:number}})=>condition.summary.total)).toEqual([1,1]);
  expect(result.evaluation.outcomes.aborted).toEqual({count:1,rate:.5});
  expect(result.trials[0].environment.contextId).not.toBe(result.trials[1].environment.contextId);
  expect(result.trials[0].environment.viewport.width).toBe(1280);
  expect(result.trials[1].environment.viewport.width).toBe(1200);
});
test('a sidebar is a distinct region and preset storage excludes experiment data',async({page})=>{
  await page.goto('/');await page.locator('#fixture-choice').selectOption('article');await page.locator('#save-preset').click();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('gaze-caret-preset-v1')!));expect(saved['fixture-choice']).toBe('article');expect(Object.keys(saved).sort()).toEqual(['schema','mode','fixture-choice','total','block','line-height','seed'].sort());
  const measured=await page.evaluate(async()=>{
    const path='/src/layout.ts';const {measureFixture,nearestLine}=await import(path) as typeof import('../../src/layout.ts');
    const layout=measureFixture(document.getElementById('fixture')!);const side=layout.targets.find(t=>t.region==='sidebar')!;
    return {sideCount:layout.targets.filter(t=>t.region==='sidebar').length,selected:nearestLine(side,layout.lines,48)?.region};
  });expect(measured.sideCount).toBeGreaterThan(0);expect(measured.selected).toBe('sidebar');
});
test('bundled model and WASM run with a fake camera, and stopping releases the video',90000,async({page})=>{
  await page.goto('/');await page.locator('#start').click();
  await expect(page.locator('#camera-status')).toHaveText('カメラ使用中',{timeout:60000});
  await page.waitForTimeout(2000);await expect(page.locator('#stage-title')).toHaveText('配置と写り方を確認');
  await page.locator('#pause').click();await expect(page.locator('#camera-status')).toHaveText('カメラ停止中');
  expect(await page.locator('#camera-preview').evaluate(el=>(el as HTMLVideoElement).srcObject)).toBe(null);
});
test('interrupting an unfinished coordinate check preserves the presented target in JSON',async({page})=>{
  await startDemo(page);await page.locator('#overlay-stop').click();await page.locator('#finish').click();
  const download=page.waitForEvent('download');await page.locator('#json').click();
  const artifact=await download;const path=await artifact.path();const result=JSON.parse(await Deno.readTextFile(path!));
  expect(result.validation).toHaveLength(1);expect(result.validation[0].points).toHaveLength(1);
  expect(result.validation[0].points[0].reason).toBe('aborted:manual-pause');expect(result.trials).toHaveLength(0);
  expect(result.schemaVersion).toBe(2);expect(result.evaluation.total).toBe(0);
  expect(result.evaluation.outcomes.exact).toEqual({count:0,rate:null});
  expect(result.evaluation.conditions).toEqual([]);
});
