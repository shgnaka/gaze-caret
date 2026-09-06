import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
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
  await expect(page.locator('[data-current]')).toHaveCount(1);
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
test('complete a demo with a break, preserve failures, and share only after explicit consent', async({page})=>{
  test.setTimeout(90000);
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
  await page.locator('#share-consent').check();
  const href=await page.locator('#share').getAttribute('href');expect(new URL(href!).searchParams.get('body')).toContain('exact: 12');
  const download=page.waitForEvent('download');await page.locator('#json').click();
  const artifact=await download;expect(artifact.suggestedFilename()).toMatch(/gaze-caret-.+\.json$/);
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
test('resize during a trial records an abort and prevents a stale selection',async({page})=>{
  test.setTimeout(45000);await startDemo(page);await validation(page);for(let i=0;i<3;i++)await trial(page);await page.locator('#formal').click();
  await page.setViewportSize({width:1200,height:900});await expect(page.locator('#stage-title')).toHaveText('一時停止しました');
  await page.keyboard.press('Space');await page.locator('#finish').click();
  await expect(page.locator('#share-preview')).toHaveValue(/Started: 1[\s\S]*aborted: 1/);
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
test('bundled model and WASM run with a fake camera, and stopping releases the video',async({page})=>{
  test.setTimeout(90000);await page.goto('/');await page.locator('#start').click();
  await expect(page.locator('#camera-status')).toHaveText('カメラ使用中',{timeout:60000});
  await page.waitForTimeout(2000);await expect(page.locator('#stage-title')).toHaveText('配置と写り方を確認');
  await page.locator('#pause').click();await expect(page.locator('#camera-status')).toHaveText('カメラ停止中');
  expect(await page.locator('#camera-preview').evaluate(el=>(el as HTMLVideoElement).srcObject)).toBe(null);
});
test('interrupting an unfinished coordinate check preserves the presented target in JSON',async({page})=>{
  await startDemo(page);await page.locator('#overlay-stop').click();await page.locator('#finish').click();
  const download=page.waitForEvent('download');await page.locator('#json').click();
  const artifact=await download;const path=await artifact.path();const result=JSON.parse(await readFile(path!,'utf8'));
  expect(result.validation).toHaveLength(1);expect(result.validation[0].points).toHaveLength(1);
  expect(result.validation[0].points[0].reason).toBe('aborted:manual-pause');expect(result.trials).toHaveLength(0);
});
