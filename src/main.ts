import './style.css';
import { Experiment, GazeHistory, OUTCOMES, issueBody, issueUrl } from './core/runner.ts';
import type { Mode, RunConfig, Target } from './core/runner.ts';
import { selectGazePoint } from './core/select-gaze-point.ts';
import type { Point, GazeDecision } from './core/select-gaze-point.ts';
import { fitRidge, predict, balancedSamples } from './core/regression.ts';
import type { RidgeModel, CalibrationSample } from './core/regression.ts';
import { extractFeatures, acceptsCalibrationFrame } from './core/features.ts';
import { CameraSession } from './core/camera-session.ts';
import { FIXTURES, fixtureHtml, measureFixture, nearestLine, lineTarget } from './layout.ts';
import type { Layout } from './layout.ts';
import type { FaceLandmarker } from '@mediapipe/tasks-vision';
declare const __BUILD_COMMIT__: string;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const value = (id: string) => $<HTMLInputElement>(id).value;
const checked = (id: string) => $<HTMLInputElement>(id).checked;
const now = () => performance.now();
const uid = () => crypto.randomUUID();
const escapeHtml = (s: string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
type Stage = 'configure'|'camera'|'calibration'|'validation'|'validation-done'|'practice'|'practice-done'|'measure'|'break'|'paused'|'results';
let stage: Stage='configure', mode: Mode='camera', run: Experiment | null=null, practice: Experiment | null=null;
let sessionId='',revision=0,layoutRevision=0,contextId='',modelId='',model:RidgeModel|null=null;
let frame=0,lastInference=0,lastVideoTime=-1,lastFeaturesAt=-Infinity,latestFeatures:number[]|null=null;
let pointer:Point|null=null,viewportSignature='',resuming=false,layout:Layout={lines:[],targets:[]};
let rng:()=>number=()=>0,feedbackTimer:number|undefined,calTimer:number|undefined;
const history=new GazeHistory(),camera=new CameraSession<MediaStream,FaceLandmarker>();
let calibrationGroups:CalibrationSample[][]=[],calibrationOrder:Point[]=[],calibrationIndex=0,calibrationStarted=0,calibrationPointStarted=0;
let calibrationSummary:{ modelId:string; sampleCount:number; elapsedMs:number; contextId:string }[]=[];
let placement={position:'unknown',osScale:null as number|null,confirmed:false},cameraSettings:{width?:number;height?:number;frameRate?:number}={};
let trialMeta:Record<number,unknown>={},decisions:Record<number,GazeDecision>={};
let stats={frames:0,validFrames:0,inferenceTotalMs:0,inferenceMaxMs:0};
interface Validation { purpose:string; contextId:string; modelId:string; points:{ target:Point; point:Point|null; reason:string|null; error:number|null }[] }
let validations:Validation[]=[],validation:Validation|null=null,validationTargets:Point[]=[],validationIndex=0,validationPresented=0,validationBusy=false;
const signature=()=>[innerWidth,innerHeight,devicePixelRatio,screenX,screenY].join(':');
const viewport=()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,screenX,screenY});
const outcomeText={exact:'正しい行',adjacent:'隣の行','other-line':'同じ段落の別の行','other-block':'別の段落',unavailable:'候補なし',aborted:'中断'};
const reasonText:Record<string,string>={'insufficient-samples':'有効な視線が足りません','stale-data':'視線データが古くなっています','invalid-context':'校正を確認してください','excessive-spread':'視線が安定していません','too-far':'近くに候補の文章がありません'};

$('app').innerHTML=`
<header class="topbar"><a class="wordmark" href="./">gaze<span>caret</span><small>実験室</small></a><div class="top-actions"><span id="camera-status" class="camera-status">カメラ停止中</span><button id="pause" class="quiet" disabled>一時停止</button><button id="finish" class="quiet" disabled>終了して結果へ</button></div></header>
<div id="demo-banner" class="demo-banner" hidden>DEMO — マウスの位置を視線の代わりに使います。視線の精度を測った結果にはなりません。</div>
<main class="workspace" id="experiment" tabindex="-1">
 <aside class="control-panel"><ol class="steps" aria-label="実験の手順"><li data-step="0">準備</li><li data-step="1">配置・校正</li><li data-step="2">精度確認</li><li data-step="3">練習</li><li data-step="4">本測定</li><li data-step="5">結果</li></ol>
 <div class="section-label">SESSION GUIDE</div><h1 id="stage-title">実験を準備</h1><div id="stage-body"></div>
 <div id="camera-panel" hidden><video id="camera-preview" autoplay muted playsinline></video><p id="quality" role="status">カメラを準備しています</p></div>
 <p class="notice" id="status" role="status" aria-live="polite"></p></aside>
 <section class="reading-panel"><div class="reading-top"><span id="fixture-label">1 段組の文章</span><span id="counter">プレビュー</span></div><div id="trial-prompt" role="status">中央の文章を使って、見ている行を確かめます。</div><div id="fixture"></div><div class="reading-footer"><span id="key-hint">カメラは開始ボタンを押すまで使いません。</span><span id="progress-label"></span></div><progress id="progress" max="60" value="0" aria-label="測定の進み具合"></progress></section>
</main><footer class="app-footer"><span>映像は端末内で処理。画像・映像・音声は保存しません。</span><span id="build-id"></span></footer>
<div id="overlay" hidden><div id="overlay-progress"></div><div id="aim-marker" aria-label="注視する点"></div><p id="overlay-caption"></p><button id="overlay-stop">中断する</button></div><div id="selection-marker" hidden></div>`;
const video=$<HTMLVideoElement>('camera-preview');
$('build-id').textContent=`実験版 ${__BUILD_COMMIT__.slice(0,8)}`;
$('fixture').innerHTML=fixtureHtml('baseline');

function setStage(next:Stage,title:string,html:string):void {
  stage=next;document.body.dataset.stage=next;$('stage-title').textContent=title;$('stage-body').innerHTML=html;
  const index={configure:0,camera:1,calibration:1,validation:2,'validation-done':2,practice:3,'practice-done':3,measure:4,break:4,paused:4,results:5}[next];
  document.querySelectorAll<HTMLElement>('[data-step]').forEach((el,i)=>{el.classList.toggle('active',i===index);el.classList.toggle('done',i<index);});
  $('camera-panel').hidden=next!=='camera';$('status').textContent='';
  $<HTMLButtonElement>('pause').disabled=['configure','paused','results'].includes(next);
  $<HTMLButtonElement>('finish').disabled=next==='configure'||next==='results';
}
function random(seed:number):()=>number {let x=seed>>>0;return()=>{x+=0x6d2b79f5;let t=Math.imul(x^(x>>>15),1|x);t^=t+Math.imul(t^(t>>>7),61|t);return((t^(t>>>14))>>>0)/4294967296;};}
function shuffled<T>(items:readonly T[],next:()=>number):T[]{const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(next()*(i+1));[a[i],a[j]]=[a[j]!,a[i]!];}return a;}
function clearTimers():void {clearTimeout(calTimer);clearTimeout(feedbackTimer);validationBusy=false;}
function hideOverlay():void {$('overlay').hidden=true;$('selection-marker').hidden=true;}
function showAim(point:Point,caption:string,progress:string):void {
  $('overlay').hidden=false;$('aim-marker').style.left=`${point.x}px`;$('aim-marker').style.top=`${point.y}px`;
  $('overlay-caption').textContent=caption;$('overlay-progress').textContent=progress;
  $('experiment').focus();
}
function configure():void {
  hideOverlay();$('demo-banner').hidden=true;
  setStage('configure','実験を準備',`<p>使うページと条件を選び、短い練習から始めます。</p><div id="size-warning" class="warning" hidden>実測には幅 1000 px・高さ 750 px 以上のウィンドウを使ってください。</div>
  <label>入力方法<select id="mode"><option value="camera">実カメラ</option><option value="demo">デモ（マウスで代用）</option></select></label>
  <label>文章のレイアウト<select id="fixture-choice">${Object.entries(FIXTURES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>
  <div class="field-pair"><label>本測定<select id="total"><option value="12">12 試行・動作確認</option><option value="60">60 試行・基準測定</option></select></label><label>休憩の間隔<select id="block"><option value="6">6 試行</option><option value="10">10 試行</option><option value="20">20 試行</option></select></label></div>
  <div class="field-pair"><label>行間<select id="line-height"><option value="24">24 px</option><option value="32">32 px</option></select></label><label>提示順の seed<input id="seed" type="number" min="0" max="999999" value="42"></label></div>
  <button id="start" class="primary">実験を始める</button><button id="save-preset" class="quiet full">この条件をブラウザに保存</button><p class="fineprint">保存するのは実験条件だけです。校正・視線・結果はページを閉じると消えます。</p>`);
  try {const raw=JSON.parse(localStorage.getItem('gaze-caret-preset-v1')||'null');if(raw&&raw.schema===1){for(const id of ['mode','fixture-choice','total','block','line-height','seed']){const el=$<HTMLInputElement|HTMLSelectElement>(id),v=String(raw[id]);if(el instanceof HTMLSelectElement){if([...el.options].some(o=>o.value===v))el.value=v;}else if(/^\d{1,6}$/.test(v))el.value=v;}}}catch{/* A malformed optional preference never blocks a new experiment. */}
  const preview=()=>{$('fixture').innerHTML=fixtureHtml(value('fixture-choice'));$('fixture').style.lineHeight=`${value('line-height')}px`;$('fixture-label').textContent=FIXTURES[value('fixture-choice') as keyof typeof FIXTURES];};
  $('fixture-choice').onchange=preview;$('line-height').onchange=preview;preview();
  $('size-warning').hidden=innerWidth>=1000&&innerHeight>=750;
  $('start').onclick=()=>{void startRun();};
  $('save-preset').onclick=()=>{try{const preset:Record<string,unknown>={schema:1};for(const id of ['mode','fixture-choice','total','block','line-height','seed'])preset[id]=value(id);localStorage.setItem('gaze-caret-preset-v1',JSON.stringify(preset));$('status').textContent='実験条件を保存しました。';}catch{$('status').textContent='条件を保存できませんでした。保存なしでも実験できます。';}};
}
let lineHeight=24;
async function startRun():Promise<void> {
  mode=value('mode') as Mode;
  if(mode==='camera'&&(innerWidth<1000||innerHeight<750)){$('status').textContent='ウィンドウを広げてから開始してください。';return;}
  const seed=Number(value('seed'));if(!Number.isSafeInteger(seed)||seed<0||seed>999999){$('status').textContent='seed は 0〜999999 の整数で入力してください。';return;}
  const total=Number(value('total'));
  const config:RunConfig={mode,total,blockSize:Math.min(total,Number(value('block'))),fixture:value('fixture-choice'),seed};
  lineHeight=Number(value('line-height'));run=new Experiment(config);practice=null;sessionId=uid();revision=0;layoutRevision=0;
  calibrationSummary=[];validations=[];trialMeta={};decisions={};stats={frames:0,validFrames:0,inferenceTotalMs:0,inferenceMaxMs:0};rng=random(seed);
  $('demo-banner').hidden=mode!=='demo';$<HTMLProgressElement>('progress').max=total;updateCounter();
  await setupCamera();
}
function newContext():void {revision++;contextId=`${sessionId}:${revision}`;modelId='';model=null;history.clear();latestFeatures=null;lastFeaturesAt=-Infinity;viewportSignature=signature();}
async function setupCamera(deviceId?:string):Promise<void> {
  clearTimers();hideOverlay();stopCamera();newContext();
  setStage('camera','配置と写り方を確認',`<p>${mode==='demo'?'このデモではカメラを使いません。後で点や文章へマウスを合わせて Space を押します。':'顔と両目が映るように座ってください。カメラを動かしたときは、ここから校正し直します。'}</p>
  <label>画面に対するカメラの位置<select id="placement"><option value="top">上</option><option value="bottom">下</option><option value="left">左</option><option value="right">右</option><option value="other">その他・ずれた位置</option><option value="unknown">不明</option></select></label>
  <label>OS の表示倍率（任意・%）<input id="os-scale" type="number" min="50" max="400" placeholder="例: 125"></label>
  <label id="device-label" ${mode==='demo'?'hidden':''}>使用カメラ<select id="device"><option value="">自動選択</option></select></label>
  <label class="check-label"><input id="placement-confirm" type="checkbox">配置と写り方を確認しました</label><button id="calibrate" class="primary" disabled>${mode==='demo'?'デモの校正を完了して進む':'校正を始める（9 点 × 2 巡）'}</button>`);
  $<HTMLSelectElement>('placement').value=placement.position;
  if(placement.osScale!==null)$<HTMLInputElement>('os-scale').value=String(placement.osScale);
  $('camera-panel').hidden=mode==='demo';
  $('placement-confirm').onchange=updateQuality;
  $('calibrate').onclick=()=>{placement={position:value('placement'),osScale:value('os-scale')?Number(value('os-scale')):null,confirmed:true};if(mode==='demo'){modelId='demo-pointer';beginValidation(run!.trials.length>0);}else beginCalibration();};
  if(mode==='demo'){startFrames();updateQuality();return;}
  const expected=contextId;
  $('camera-status').textContent='カメラを起動中';
  try {
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('camera-context');
    const started=await camera.start(
      ()=>navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:30},...(deviceId?{deviceId:{exact:deviceId}}:{})}}),
      async()=>{const { FaceLandmarker,FilesetResolver }=await import('@mediapipe/tasks-vision');const vision=await FilesetResolver.forVisionTasks(new URL('./wasm/',document.baseURI).href);return FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:new URL('./models/face_landmarker.task',document.baseURI).href,delegate:'CPU'},runningMode:'VIDEO',numFaces:2,minFaceDetectionConfidence:.5,minFacePresenceConfidence:.5,minTrackingConfidence:.5});},
    );
    if(!started||contextId!==expected)return;
    video.srcObject=camera.stream;await video.play();if(contextId!==expected)return;
    const settings=camera.stream!.getVideoTracks()[0]!.getSettings();cameraSettings={};
    if(settings.width!==undefined)cameraSettings.width=settings.width;if(settings.height!==undefined)cameraSettings.height=settings.height;if(settings.frameRate!==undefined)cameraSettings.frameRate=settings.frameRate;
    const stream=camera.stream;stream!.getVideoTracks().forEach(t=>{t.onended=()=>{if(camera.stream===stream)pauseRun('camera-disconnected');};});
    $('camera-status').textContent='カメラ使用中';startFrames();
    const devices=await navigator.mediaDevices.enumerateDevices();if(contextId!==expected||stage!=='camera')return;
    const select=$<HTMLSelectElement>('device');select.replaceChildren(new Option('自動選択',''));
    devices.filter(d=>d.kind==='videoinput').forEach((d,i)=>select.add(new Option(d.label||`カメラ ${i+1}`,d.deviceId)));select.value=deviceId??'';
    select.onchange=()=>{void setupCamera(select.value||undefined);};
  } catch(error) {
    if(contextId!==expected)return;stopCamera();
    const name=error instanceof Error?error.name:'Error';
    $('status').textContent=({NotAllowedError:'カメラが許可されていません。ブラウザの権限を確認して再試行してください。',NotFoundError:'利用できるカメラがありません。',NotReadableError:'カメラを開始できません。他のアプリの使用状況を確認してください。',OverconstrainedError:'選んだカメラを利用できません。'} as Record<string,string>)[name]??'カメラまたは推定モデルを読み込めませんでした。接続を確認して再試行してください。';
    const retry=document.createElement('button');retry.textContent='再試行';retry.onclick=()=>{void setupCamera();};$('stage-body').append(retry);
  }
}
function stopCamera():void {cancelAnimationFrame(frame);camera.stop();video.srcObject=null;latestFeatures=null;lastFeaturesAt=-Infinity;history.clear();$('camera-status').textContent='カメラ停止中';}
function updateQuality():void {
  if(stage!=='camera')return;
  const usable=mode==='demo'||now()-lastFeaturesAt<350;
  $('quality').textContent=usable?'顔と両目を検出しています。精度は次の校正・検証で確認します。':'顔と両目がはっきり映る位置、明るさ、眼鏡の反射を確認してください。';
  $<HTMLButtonElement>('calibrate').disabled=!checked('placement-confirm')||!usable;
}
function startFrames():void {cancelAnimationFrame(frame);lastInference=0;lastVideoTime=-1;frame=requestAnimationFrame(tick);}
function tick(at:number):void {
  frame=requestAnimationFrame(tick);
  if(viewportSignature!==signature()){pauseRun('viewport-changed');return;}
  if(at-lastInference<1000/15)return;lastInference=at;
  let features:number[]|null=null,point:Point|null=null;const sampledAt=now();
  if(mode==='demo'){point=pointer;}
  else {
    if(!camera.detector||video.readyState<2||video.currentTime===lastVideoTime){updateQuality();return;}
    lastVideoTime=video.currentTime;
    try {const result=camera.detector.detectForVideo(video,sampledAt);features=extractFeatures(result.faceLandmarks,video.videoWidth,video.videoHeight);}catch{pauseRun('detector-error');return;}
    latestFeatures=features;if(features)lastFeaturesAt=sampledAt;
    if(features&&model){const p=predict(model,features);if(p)point={x:p.x*innerWidth,y:p.y*innerHeight};}
  }
  const producedAt=now(),elapsed=producedAt-sampledAt;stats.frames++;if(features||mode==='demo'&&point)stats.validFrames++;stats.inferenceTotalMs+=elapsed;stats.inferenceMaxMs=Math.max(stats.inferenceMaxMs,elapsed);
  if(stage==='calibration'&&features){const group=calibrationGroups[calibrationIndex]!;if(acceptsCalibrationFrame(calibrationPointStarted,sampledAt,group.length))group.push({features:[...features],target:calibrationOrder[calibrationIndex]!,group:calibrationIndex});}
  history.add({x:point?.x??null,y:point?.y??null,sampledAt,producedAt,contextId,modelId,valid:!!point,invalidReason:point?null:'no-features-or-model'});updateQuality();
}
function beginCalibration():void {
  const points=[.1,.5,.9].flatMap(y=>[.1,.5,.9].map(x=>({x,y})));
  calibrationOrder=[...shuffled(points,rng),...shuffled(points,rng)];calibrationGroups=calibrationOrder.map(()=>[]);calibrationIndex=0;calibrationStarted=now();model=null;history.clear();
  setStage('calibration','校正しています','<p>表示される点を見てください。キー操作は不要です。</p>');calibrationNext();
}
function calibrationNext():void {
  if(calibrationIndex===calibrationOrder.length){
    try {const samples=balancedSamples(calibrationGroups);model=fitRidge(samples);modelId=uid();calibrationSummary.push({modelId,sampleCount:samples.length,elapsedMs:now()-calibrationStarted,contextId});calibrationGroups=[];history.clear();beginValidation(run!.trials.length>0);}catch{hideOverlay();pauseRun('calibration-failed');}return;
  }
  const p=calibrationOrder[calibrationIndex]!;calibrationGroups[calibrationIndex]=[];calibrationPointStarted=now();
  showAim({x:p.x*innerWidth,y:p.y*innerHeight},'点の中央を見てください。自然な姿勢のままで大丈夫です。',`校正 ${calibrationIndex+1} / 18`);
  calTimer=window.setTimeout(()=>{
    if(stage!=='calibration')return;
    if(calibrationGroups[calibrationIndex]!.length<5){
      $('overlay-caption').textContent='両目のデータが足りませんでした。位置や明るさを確認して、この点だけ取り直します。';
      const retry=document.createElement('button');retry.id='retry-point';retry.textContent='この点を取り直す';retry.onclick=()=>{retry.remove();calibrationNext();};$('overlay-caption').append(document.createElement('br'),retry);return;
    }
    calibrationIndex++;calibrationNext();
  },1400);
}
function beginValidation(resume:boolean):void {
  clearTimers();resuming=resume;history.clear();
  const count=resume||run!.config.total===12?5:20;
  const next=random(run!.config.seed+101+validations.length);
  validationTargets=Array.from({length:count},()=>({x:(.18+next()*.64)*innerWidth,y:(.18+next()*.64)*innerHeight}));validationIndex=0;
  validation={purpose:resume?'resume-check':'initial-check',contextId,modelId,points:[]};
  setStage('validation','精度を確認',`<p>学習に使っていない ${count} 個の点を見て、Space で確定します。</p>`);nextValidationPoint();
}
function nextValidationPoint():void {
  validationBusy=false;history.clear();validationPresented=now();
  showAim(validationTargets[validationIndex]!,mode==='demo'?'点へマウスを合わせ、Space で確定します。':'点を見て、視線が落ち着いたら Space で確定します。',`精度確認 ${validationIndex+1} / ${validationTargets.length}`);
}
function captureValidation():void {
  if(validationBusy||now()-validationPresented<500)return;
  const d=selectGazePoint(history.snapshot(now()),{pressedAt:now(),contextId,modelId});
  const target=validationTargets[validationIndex]!;
  validation!.points.push({target,point:d.point,reason:d.reason,error:d.point?Math.hypot(d.point.x-target.x,d.point.y-target.y):null});validationBusy=true;
  $('overlay-caption').textContent=d.point?`記録しました。誤差 ${Math.round(Math.hypot(d.point.x-target.x,d.point.y-target.y))} px`:'推定できませんでした。この結果も記録します。';
  feedbackTimer=window.setTimeout(()=>{validationIndex++;if(validationIndex<validationTargets.length)nextValidationPoint();else validationDone();},550);
}
function quantile(values:number[],p:number):number|null {const a=values.filter(Number.isFinite).sort((x,y)=>x-y);return a.length?a[Math.ceil(a.length*p)-1]!:null;}
function validationDone():void {
  hideOverlay();validations.push(validation!);const errors=validation!.points.flatMap(p=>p.error===null?[]:[p.error]);
  setStage('validation-done','確認結果',`<div class="metric"><strong>${quantile(errors,.5)===null?'—':Math.round(quantile(errors,.5)!)}</strong><span>中央値の誤差 / px</span></div><p>${errors.length} / ${validation!.points.length} 点を推定できました。これは視線の精度を確認する値です。</p><p>${resuming?'同じ配置・姿勢で続けられることを確認してください。':'大きくずれる場合は、校正を取り直して比較できます。'}</p>
  <button id="accept-validation" class="primary" ${errors.length?'':'disabled'}>${resuming?'確認して測定を再開':'確認して練習へ'}</button><button id="recalibrate" class="quiet full">配置を確認して校正し直す</button>`);
  $('accept-validation').onclick=()=>{run!.validate();if(run!.phase==='results'){showResults();return;}if(resuming)beginMeasurement();else beginPractice();};
  $('recalibrate').onclick=()=>{void setupCamera();};
}
function beginPractice():void {practice=new Experiment({...run!.config,total:3,blockSize:3});practice.validate();setStage('practice','3 回だけ練習',`<p>青い枠の言葉を見て Space。結果を表示したら、次の目標へ進みます。</p><p>練習は本測定の集計に入りません。</p>`);nextTrial();}
function beginMeasurement():void {setStage('measure','本測定',`<p>青い枠の言葉を見て、Space で確定してください。</p><p>${run!.config.blockSize} 試行ごとに休憩できます。推定できなかった試行も記録します。</p>`);nextTrial();}
function nextTrial():void {
  hideOverlay();history.clear();document.querySelectorAll('[data-current]').forEach(el=>el.removeAttribute('data-current'));
  layout=measureFixture($('fixture'));
  if(!layout.targets.length){pauseRun('no-visible-text');return;}
  const active=stage==='practice'?practice!:run!,target=layout.targets[Math.floor(rng()*layout.targets.length)]!;
  if(!active.begin(target,now()))return;
  if(active===run)trialMeta[run!.trials.length+1]={contextId,modelId,layoutRevision,viewport:viewport(),placement:{...placement},lineHeight};
  document.querySelector<HTMLElement>(`[data-word="${target.id}"]`)?.setAttribute('data-current','true');
  $('trial-prompt').textContent=`青枠の「${target.text}」を見て Space`;$('key-hint').textContent=mode==='demo'?'マウスを青枠へ → Space':'見る → Space → 次の目標';$('experiment').focus();updateCounter();
}
function captureTrial():void {
  const active=stage==='practice'?practice!:run!;if(active.phase!=='trial')return;
  const pressedAt=now();const decision=selectGazePoint(history.snapshot(pressedAt),{pressedAt,contextId,modelId});
  const line=decision.point?nearestLine(decision.point,layout.lines,lineHeight*2):null;
  if(!active.decide(decision.point,line?lineTarget(line):null,decision.reason??(line?null:'too-far'),pressedAt))return;
  if(active===run)decisions[run!.trials.length]=decision;
  const trial=active.trials.at(-1)!;
  $('trial-prompt').textContent=trial.outcome==='unavailable'?(reasonText[trial.reason??'']??'今回は候補を決められませんでした'):outcomeText[trial.outcome];
  if(line){const marker=$('selection-marker'),rects=line.fragments,left=Math.min(...rects.map(r=>r.left)),top=Math.min(...rects.map(r=>r.top));marker.hidden=false;marker.style.cssText=`left:${left}px;top:${top}px;width:${Math.max(...rects.map(r=>r.right))-left}px;height:${Math.max(...rects.map(r=>r.bottom))-top}px;`;marker.dataset.correct=String(trial.outcome==='exact');}
  updateCounter();feedbackTimer=window.setTimeout(()=>{
    active.advance();if(active.phase==='results'){
      if(active===practice){hideOverlay();setStage('practice-done','練習が終わりました','<p>本測定ではモデルと条件を固定します。休憩や中断はいつでもできます。</p><button id="formal" class="primary">本測定を始める</button>');$('formal').onclick=beginMeasurement;}else showResults();
    }else if(active.phase==='break')showBreak();else nextTrial();
  },800);
}
function updateCounter():void {
  if(!run)return;const active=stage==='practice'?practice!:run;
  $('counter').textContent=`${stage==='practice'?'練習':'本測定'} ${active.trials.length} / ${active.config.total}`;
  $<HTMLProgressElement>('progress').value=run.trials.length;$('progress-label').textContent=`${run.trials.length} / ${run.config.total}`;
}
function showBreak():void {hideOverlay();history.clear();setStage('break','ひと休み',`<p>${run!.trials.length} 試行を記録しました。顔や画面の位置が変わっていないか確認して続けましょう。</p><p>${mode==='camera'?'カメラは使用中です。一時停止するとカメラも止まります。':''}</p><button id="resume-validation" class="primary">精度を確認して続ける</button><button id="moved" class="quiet full">カメラの位置を変えた</button>`);$('resume-validation').onclick=()=>beginValidation(true);$('moved').onclick=()=>{void setupCamera();};}
function pauseRun(reason:string):void {
  if(['configure','paused','results'].includes(stage))return;
  clearTimers();run?.interrupt(reason,now());practice?.interrupt(reason,now());stopCamera();model=null;modelId='';revision++;contextId=`${sessionId}:${revision}`;calibrationGroups=[];hideOverlay();
  setStage('paused','一時停止しました',`<p>カメラを停止しました。確定済みの結果と中断した試行は保持しています。</p><p>${({'viewport-changed':'ウィンドウの位置・サイズ・倍率が変わりました。','layout-changed':'文章の位置が変わったため、古い候補を破棄しました。','hidden':'別のタブへ移動したため停止しました。','camera-disconnected':'カメラとの接続が切れました。','no-visible-text':'測定できる文章が表示範囲にありません。'} as Record<string,string>)[reason]??'再開前に配置と精度を確認します。'}</p><button id="resume" class="primary">配置を確認して再開</button>`);$('resume').onclick=()=>{void setupCamera();};updateCounter();
}
function report():object {return{schemaVersion:1,experiment:'gaze-caret-runner-v1',build:__BUILD_COMMIT__,sessionId,generatedAt:new Date().toISOString(),config:run!.config,lineHeight,mode,scope:run!.config.total===60?'baseline-protocol':'quick-check',featureVersion:'iris-head-12-v1',engine:mode==='demo'?'mouse-pointer':'mediapipe-0.10.32-cpu-ridge-lambda-1',viewport:viewport(),camera:cameraSettings,calibrations:calibrationSummary,validation:validations,practiceTrials:practice?.trials??[],trials:run!.trials.map(t=>({...t,environment:trialMeta[t.id]??null,decision:decisions[t.id]??null})),frameSummary:stats,feedback:value('feedback'),notes:'Images, video, audio, device IDs and continuous gaze history are not included. Demo and quick-check results do not establish gaze accuracy.'};}
function download(text:string,type:string,extension:string):void {const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=`gaze-caret-${sessionId}.${extension}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function showResults():void {
  clearTimers();hideOverlay();stopCamera();if(!run)return;
  const total=run.trials.length,exact=run.trials.filter(t=>t.outcome==='exact').length;
  setStage('results','結果とフィードバック',`<div class="metric"><strong>${total?Math.round(exact/total*100):'—'}<small>${total?'%':''}</small></strong><span>${mode==='demo'?'デモの行一致率':'正しい行の割合'}</span></div><p>${total} 試行を記録。候補なし・中断も分母に含みます。</p>
  <table class="counts"><tbody>${OUTCOMES.map(o=>`<tr><th>${outcomeText[o]}</th><td>${run!.trials.filter(t=>t.outcome===o).length}</td></tr>`).join('')}</tbody></table>
  <button id="json" class="primary">詳細結果をダウンロード（JSON）</button><button id="csv" class="quiet full">試行一覧をダウンロード（CSV）</button><button id="new-run" class="quiet full">結果を破棄して新しい実験</button>`);
  $('fixture').innerHTML=`<section class="report-panel"><div class="section-label">FEEDBACK</div><h2>次の改善につなげる</h2><p>ずれ方、疲れやすさ、操作で困ったことを残してください。</p><label>感想・気づき<textarea id="feedback" maxlength="500" rows="4" placeholder="例：右側の文章だけ、1 行下にずれる。"></textarea></label><label>共有する集計<textarea id="share-preview" rows="12" readonly></textarea></label><div class="share-actions"><button id="copy-report">集計と感想をコピー</button><label class="check-label"><input id="share-consent" type="checkbox">集計と感想を、誰でも読める GitHub Issue で共有する</label><a id="share" class="button-link" target="_blank" rel="noopener noreferrer" aria-disabled="true">GitHub で投稿内容を確認</a></div><p class="fineprint">リンク先で内容を確認し、投稿してください。投稿後、このチャットで「結果を見て」と伝えると取得できます。投稿だけでチャットが自動起動することはありません。非公開で渡す場合は、コピーした内容や JSON をこのチャットに添付できます。</p></section>`;
  $('trial-prompt').textContent=mode==='demo'?'デモの結果です。視線の精度評価には使いません。':'今回の結果を保存し、次の実験と比較できます。';$('key-hint').textContent='画像・映像を送る必要はありません。';updateCounter();
  const summary=()=>`Build: ${__BUILD_COMMIT__}\nLine height: ${lineHeight} CSS px\nProtocol: ${run!.config.total===60?'baseline':'quick-check'}\n\n${issueBody(sessionId,run!.config,run!.trials,value('feedback'))}`;
  const update=()=>{$<HTMLTextAreaElement>('share-preview').value=summary();const a=$<HTMLAnchorElement>('share');a.setAttribute('aria-disabled',String(!checked('share-consent')));if(checked('share-consent')){try{a.href=issueUrl(summary(),sessionId);}catch{a.removeAttribute('href');$('status').textContent='共有内容が長いため、コピーして貼り付けてください。';}}else a.removeAttribute('href');};
  $('feedback').oninput=update;$('share-consent').onchange=update;update();
  $('copy-report').onclick=async()=>{try{await navigator.clipboard.writeText(summary());$('status').textContent='コピーしました。このチャットにも貼り付けられます。';}catch{$<HTMLTextAreaElement>('share-preview').select();$('status').textContent='表示した集計を手動でコピーしてください。';}};
  $('json').onclick=()=>download(JSON.stringify(report(),null,2),'application/json','json');
  $('csv').onclick=()=>{const rows=[['sessionId','trialId','outcome','targetId','block','region','line','x','y','reason','contextId','modelId'],...run!.trials.map(t=>{const meta=trialMeta[t.id] as {contextId?:string;modelId?:string}|undefined;return[sessionId,t.id,t.outcome,t.target.id,t.target.block,t.target.region,t.target.line,t.point?.x??'',t.point?.y??'',t.reason??'',meta?.contextId??'',meta?.modelId??''];})];download('\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n'),'text/csv;charset=utf-8','csv');};
  $('new-run').onclick=()=>{if(confirm('保存していない結果も破棄します。新しい実験を始めますか？')){run=null;practice=null;model=null;validations=[];calibrationSummary=[];calibrationGroups=[];trialMeta={};decisions={};configure();}};
}
$('pause').onclick=()=>pauseRun('manual-pause');$('overlay-stop').onclick=()=>pauseRun('manual-pause');
$('finish').onclick=()=>{run?.interrupt('ended-early',now());showResults();};
document.addEventListener('mousemove',event=>{if(mode==='demo')pointer={x:event.clientX,y:event.clientY};});
document.addEventListener('keydown',event=>{
  if(event.code!=='Space'||event.repeat||event.isComposing||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey)return;
  if(event.composedPath().some(el=>el instanceof HTMLElement&&(el.matches('input,textarea,select,button,a')||el.isContentEditable)))return;
  if(stage==='validation'){event.preventDefault();captureValidation();}else if(stage==='practice'||stage==='measure'){event.preventDefault();captureTrial();}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseRun('hidden');});
window.addEventListener('resize',()=>{if(stage!=='configure')pauseRun('viewport-changed');});
document.addEventListener('scroll',()=>{if(stage==='measure'||stage==='practice'){layoutRevision++;pauseRun('layout-changed');}},true);
document.fonts.addEventListener('loadingdone',()=>{if(stage==='measure'||stage==='practice'){layoutRevision++;pauseRun('layout-changed');}});
window.addEventListener('pagehide',()=>{clearTimers();stopCamera();});
window.addEventListener('beforeunload',event=>{if(run?.trials.length){event.preventDefault();event.returnValue='';}});
configure();
