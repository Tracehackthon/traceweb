export const MENU_TIMING = Object.freeze({ open: 220, close: 360, recheck: 80, safe: 1200, drag: 420 });
const cross = (a, b, p) => (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
export function pointInTriangle(p, a, b, c) {
  if (Math.abs(cross(a,b,c)) < 0.001) return false;
  const s = [cross(a,b,p), cross(b,c,p), cross(c,a,p)];
  return ! (s.some(v => v < 0) && s.some(v => v > 0));
}
export function inMenuSafeZone(point, previous, parent, child, side = 'right') {
  if (!point || !previous || !parent || !child) return false;
  if (point.x >= child.left && point.x <= child.right && point.y >= child.top && point.y <= child.bottom) return false;
  const width = Math.min(90, Math.max(56, parent.width * .43));
  const right = side === 'right';
  if (point.x < (right ? parent.right-width : parent.left) || point.x > (right ? parent.right : parent.left+width)) return false;
  const x = right ? child.left : child.right;
  return pointInTriangle(point, previous, {x,y:child.top}, {x,y:child.bottom});
}
