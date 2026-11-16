// Input projection only. Product validates and owns the resulting immutable
// material; this module has no storage, network, AI or canvas state.
const fail = message => { throw new Error(message); };
export const captureKinds = ['text', 'dialogue', 'code', 'web'];
export function sourceUrl(value, required = false) {
  const input = value.trim();
  if (!input) return required ? fail('网页摘录需要原网页地址。') : undefined;
  let url;
  try { url = new URL(input); } catch { return fail('来源地址需要完整的 http 或 https 网址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return fail('来源只接受不含登录凭据的 http 或 https 网址。');
  return url.href;
}
export function textSelection(text, start, end) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > text.length) return fail('请先选中原文中要留下的片段。');
  const split = n => n > 0 && n < text.length && /[\uD800-\uDBFF]/.test(text[n - 1]) && /[\uDC00-\uDFFF]/.test(text[n]);
  if (split(start) || split(end)) return fail('选段不能切开一个完整字符，请重新选择。');
  return { type: 'text', start, end };
}
export function textCapture({ kind, title, original, url = '', selection = null }) {
  if (!captureKinds.includes(kind)) return fail('不支持的文字材料类型。');
  if (!original.trim() || original.length > 1_000_000) return fail('请留下非空原文；当前文字材料上限为一百万字符。');
  const locator = selection ? textSelection(original, selection.start, selection.end) : undefined;
  const address = sourceUrl(url, kind === 'web');
  return {
    kind, title: title.trim() || ({ text: '一段文字', dialogue: '一段对话', code: '一段代码', web: '网页摘录' })[kind],
    text: locator ? original.slice(locator.start, locator.end) : original,
    origin: { kind: address ? 'web' : 'manual', fileName: '保留的原文.txt', ...(address ? { url: address } : {}), ...(locator ? { locator } : {}) },
  };
}
function milliseconds(value, label) {
  if (!/^\d+(?:\.\d{1,3})?$/.test(String(value).trim())) return fail(`${label}请填写秒数，最多三位小数。`);
  const ms = Math.round(Number(value) * 1000);
  if (!Number.isSafeInteger(ms)) return fail(`${label}超出可记录范围。`);
  return ms;
}
export function timeLocator(start, end, duration) {
  const startMs = milliseconds(start, '开始时间'), endMs = milliseconds(end, '结束时间');
  if (!Number.isFinite(duration) || duration <= 0) return fail('请等待原件时长读取完成，不能猜测片段范围。');
  if (endMs <= startMs) return fail('结束时间必须晚于开始时间。');
  if (endMs > Math.round(duration * 1000)) return fail('片段超出原件时长，请调整结束时间。');
  return { type: 'time', startMs, endMs };
}
export function percentRect({ x, y, width, height }) {
  const values = [x, y, width, height].map(n => typeof n === 'string' && !n.trim() ? NaN : Number(n));
  if (values.some(n => !Number.isFinite(n)) || values[0] < 0 || values[1] < 0 || values[2] <= 0 || values[3] <= 0 || values[0] + values[2] > 100 || values[1] + values[3] > 100) return fail('区域以左上角为起点，位置和宽高需在页面的 0–100% 范围内。');
  return Object.fromEntries(['x', 'y', 'width', 'height'].map((k, i) => [k, values[i] / 100]));
}
export function pdfLocator(page, fields, rotation, pageCount) {
  const index = Number(page), turn = Number(rotation);
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) return fail('请等待 PDF 原件校验完成，不能猜测页数。');
  if (!Number.isSafeInteger(index) || index < 1 || index > pageCount) return fail(`页码需在 1–${pageCount} 之间。`);
  if (![0, 90, 180, 270].includes(turn)) return fail('页面旋转只接受 0、90、180 或 270 度。');
  return { type: 'pdf', page: index, rect: percentRect(fields), rotation: turn };
}
export function locatorLabel(locator) {
  if (!locator) return '完整原件';
  if (locator.type === 'time') return `${(locator.startMs / 1000).toFixed(3)}–${(locator.endMs / 1000).toFixed(3)} 秒`;
  if (locator.type === 'text') return '原文中的选段，前后文已保留';
  const rect = locator.rect, area = rect ? `，${[rect.x, rect.y, rect.width, rect.height].map((n, i) => ['左', '上', '宽', '高'][i] + +(n * 100).toFixed(3) + '%').join(' / ')}` : '';
  if (locator.type === 'pdf') return `第 ${locator.page} 页${area}，${locator.rotation || 0}°`;
  return `图片局部${area}`;
}
export function materialFileKind(file) {
  const mime = file.type.toLowerCase(), name = file.name.toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (!mime || mime === 'application/octet-stream') {
    if (/\.pdf$/.test(name)) return 'pdf';
    if (/\.(mp4|webm|mov|m4v)$/.test(name)) return 'video';
    if (/\.(mp3|wav|m4a|ogg|flac)$/.test(name)) return 'audio';
    if (/\.(png|jpg|jpeg|webp|avif|gif|svg)$/.test(name)) return 'image';
  }
  return 'text';
}
export async function fileText(file) {
  if (file.size > 1_000_000 || !(file.type.startsWith('text/') || /\.(txt|md|csv|json|html?|css|js|mjs|ts|tsx|py|rs|sh|log)$/i.test(file.name))) return '';
  try { const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()); return text.includes('\0') ? '' : text; } catch { return ''; }
}
