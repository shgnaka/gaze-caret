import type { Target } from './core/runner.ts';
import type { Point } from './core/select-gaze-point.ts';
export interface Box { left: number; right: number; top: number; bottom: number }
export interface TextLine { block: string; region: string; line: number; fragments: Box[]; words: Set<string> }
export interface Layout { lines: TextLine[]; targets: Target[] }
export const FIXTURES = { baseline: '1 段組の文章', article: '本文とサイドバー', feed: 'カードと内部スクロール' } as const;
const paragraphs = [
  '朝の散歩で小さな公園を通ると、木の葉の間から光が差し込んでいました。ベンチに座って本を開き、気になる文章をゆっくり読みます。言葉を選んで記録することは、新しい考えを整理する手がかりになります。',
  '図書館の窓際には、さまざまな分野の本が並んでいます。科学の本には身近な出来事を調べる方法が、旅行の本にはまだ訪れたことのない街の様子が書かれています。ページをめくるたびに、小さな疑問が次の発見につながります。',
  '午後は机の上を片づけて、今日わかったことをノートにまとめました。最初の予想と違う結果も、その理由を考えるための大切な記録です。短い休憩をはさみながら、条件を変えてもう少し観察を続けることにしました。',
];
function paragraph(text: string, id: string, region: string): string {
  const segments = [...new Intl.Segmenter('ja', { granularity: 'word' }).segment(text)];
  return `<p data-block="${id}" data-region="${region}">${segments.map((s,i) => s.isWordLike ? `<span data-word="${id}-${i}">${s.segment}</span>` : s.segment).join('')}</p>`;
}
export function fixtureHtml(name: string): string {
  if (name === 'article') return `<div class="article-layout"><article><h2>日々の発見を記録する</h2>${paragraphs.map((p,i) => paragraph(p,`p${i}`,'main')).join('')}</article><aside class="fixture-sidebar"><h3>関連するノート</h3>${paragraph('散歩の記録。読書の習慣。身近な科学。街の風景。今日の発見。次の実験。','side','sidebar')}</aside></div>`;
  if (name === 'feed') return `<div class="feed-scroll"><div class="sticky-note" data-occluder>観察ノート</div>${[...paragraphs,...paragraphs].map((p,i) => `<article class="note-card"><h3>記録 ${i+1}</h3>${paragraph(p,`card${i}`,`card${i}`)}</article>`).join('')}</div>`;
  return `<article class="baseline-text"><h2>ある日の観察</h2>${paragraphs.map((p,i) => paragraph(p,`p${i}`,'main')).join('')}</article>`;
}
function visible(rect: DOMRect, element: Element): boolean {
  if (rect.width <= 0 || rect.height <= 0 || rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight) return false;
  for (let a: Element | null = element; a; a=a.parentElement) {
    const style=getComputedStyle(a),clip=a.getBoundingClientRect();
    if (/(hidden|auto|scroll|clip)/.test(style.overflowY) && (rect.top < clip.top || rect.bottom > clip.bottom)) return false;
    if (/(hidden|auto|scroll|clip)/.test(style.overflowX) && (rect.left < clip.left || rect.right > clip.right)) return false;
  }
  const x=(rect.left+rect.right)/2,y=(rect.top+rect.bottom)/2;
  const hit=document.elementFromPoint(x,y);
  if (!hit || !element.contains(hit)) return false;
  for (const cover of document.querySelectorAll('[data-occluder]')) {
    const r=cover.getBoundingClientRect(); if (x>=r.left && x<=r.right && y>=r.top && y<=r.bottom) return false;
  }
  return true;
}
export function measureFixture(root: HTMLElement): Layout {
  const lines: TextLine[]=[],targets: Target[]=[];
  for (const block of root.querySelectorAll<HTMLElement>('[data-block]')) {
    const blockLines: TextLine[]=[];
    const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node=walker.nextNode())) {
      const text=node.textContent ?? ''; let offset=0;
      for (const character of text) {
        const range=document.createRange(); range.setStart(node,offset); offset+=character.length; range.setEnd(node,offset);
        if (!character.trim()) continue;
        const element=node.parentElement!;
        for (const rect of range.getClientRects()) {
          if (!visible(rect,element)) continue;
          let line=blockLines.find(l => Math.abs(l.fragments[0]!.top-rect.top)<3);
          if (!line) { line={block:block.dataset.block!,region:block.dataset.region!,line:blockLines.length,fragments:[],words:new Set()};blockLines.push(line); }
          line.fragments.push({left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom});
          const word=element.closest<HTMLElement>('[data-word]'); if(word)line.words.add(word.dataset.word!);
        }
      }
    }
    lines.push(...blockLines);
    for (const word of block.querySelectorAll<HTMLElement>('[data-word]')) {
      const range=document.createRange();range.selectNodeContents(word);const rects=[...range.getClientRects()];
      const matching=blockLines.filter(l=>l.words.has(word.dataset.word!));
      if(rects.length!==1 || matching.length!==1 || !visible(rects[0]!,word))continue;
      const rect=rects[0]!,line=matching[0]!;
      targets.push({id:word.dataset.word!,text:word.textContent!,block:line.block,region:line.region,line:line.line,x:(rect.left+rect.right)/2,y:(rect.top+rect.bottom)/2});
    }
  }
  return {lines,targets};
}
export function nearestLine(point: Point, lines: readonly TextLine[], maxDistance: number): TextLine | null {
  let selected: TextLine | null=null,best=Infinity;
  for(const line of lines) for(const r of line.fragments) {
    const d=Math.hypot(Math.max(r.left-point.x,0,point.x-r.right),Math.max(r.top-point.y,0,point.y-r.bottom));
    if(d<best){best=d;selected=line;}
  }
  return best<=maxDistance ? selected : null;
}
export function lineTarget(line: TextLine): Target {
  const r=line.fragments[0]!;
  return {id:`line-${line.block}-${line.line}`,block:line.block,region:line.region,line:line.line,text:'',x:(r.left+r.right)/2,y:(r.top+r.bottom)/2};
}
