export interface Landmark { x: number; y: number; z: number }
export function extractFeatures(faces: readonly Landmark[][], width: number, height: number): number[] | null {
  if (faces.length !== 1 || !(width > 0 && height > 0)) return null;
  const f = faces[0]!;
  const indices = [33,133,468,159,145,362,263,473,386,374,234,454,1];
  if (indices.some(i => !f[i] || ![f[i]!.x,f[i]!.y,f[i]!.z].every(Number.isFinite) || f[i]!.x < 0 || f[i]!.x > 1 || f[i]!.y < 0 || f[i]!.y > 1)) return null;
  const p = (i: number) => ({ x: f[i]!.x*width, y: f[i]!.y*height });
  const eye = (a: number,b: number,iris: number,top: number,bottom: number) => {
    const c=p(a),d=p(b),v=p(iris),t=p(top),u=p(bottom);
    const dx=d.x-c.x,dy=d.y-c.y,w=Math.hypot(dx,dy);
    if (w < 8 || Math.hypot(t.x-u.x,t.y-u.y)/w < 0.08) return null;
    return [((v.x-c.x)*dx+(v.y-c.y)*dy)/(w*w), (-(v.x-c.x)*dy+(v.y-c.y)*dx)/(w*w)];
  };
  const a=eye(33,133,468,159,145), b=eye(362,263,473,386,374); if (!a || !b) return null;
  const left=p(33),right=p(263),eyeWidth=Math.hypot(right.x-left.x,right.y-left.y);
  if (eyeWidth < 20) return null;
  const mx=(left.x+right.x)/2,my=(left.y+right.y)/2,nose=p(1);
  const result = [...a,...b,mx/width,my/height,eyeWidth/width,(right.y-left.y)/eyeWidth,(nose.x-mx)/eyeWidth,(nose.y-my)/eyeWidth,f[234]!.z-f[454]!.z,(f[234]!.x+f[454]!.x)/2];
  return result.every(Number.isFinite) ? result : null;
}
export function acceptsCalibrationFrame(startedAt: number, sampledAt: number, count: number): boolean {
  return Number.isFinite(sampledAt) && sampledAt >= startedAt + 300 && sampledAt <= startedAt + 1300 && count < 15;
}
