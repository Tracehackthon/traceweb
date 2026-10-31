import React, { Suspense, useEffect, useRef, useState } from 'react';
import { makeId, type ContentEntry, type ContentValue, type WorkbenchClient } from './client';
import { WorkbenchModal } from './modal';
import { PdfPreview, LocalMedia } from './source-preview';
import { captureKinds, textCapture, timeLocator, percentRect, pdfLocator, locatorLabel } from './source-locator.mjs';
export type CaptureSource = { entry: ContentEntry; value: ContentValue };
export type CaptureDraft = { id: string; kind: string; title: string; original: string; url: string; selection: { start: number; end: number } | null; start: string; end: string; page: string; rotation: string; x: string; y: string; width: string; height: string; canvasId: string; canvasTitle: string; position: { x: number; y: number } | null };
export type CapturePlan = { id: string; kind: string; title: string; text: string; origin: NonNullable<ContentValue['origin']>; original?: string; resourceId?: string };
export function newCaptureDraft(source?: CaptureSource): CaptureDraft {
  const locator = source?.value.origin?.locator, rect = locator?.rect as { x: number; y: number; width: number; height: number } | undefined;
  return { id: makeId('material'), kind: source?.entry.kind || 'text', title: source ? source.entry.title + ' 摘录' : '', original: '', url: source?.value.origin?.url || '', selection: locator?.type === 'text' ? { start: Number(locator.start), end: Number(locator.end) } : null, start: locator?.type === 'time' ? String(Number(locator.startMs) / 1000) : '0', end: locator?.type === 'time' ? String(Number(locator.endMs) / 1000) : '', page: locator?.type === 'pdf' ? String(locator.page) : '1', rotation: String(locator?.rotation || 0), x: String((rect?.x || 0) * 100), y: String((rect?.y || 0) * 100), width: String((rect?.width ?? 1) * 100), height: String((rect?.height ?? 1) * 100), canvasId: '', canvasTitle: '', position: null };
}
export function validCaptureDraft(value: unknown): value is CaptureDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as CaptureDraft;
  const fields = ['id', 'kind', 'title', 'original', 'url', 'start', 'end', 'page', 'rotation', 'x', 'y', 'width', 'height', 'canvasId', 'canvasTitle'];
  return Object.keys(draft).every(key => [...fields, 'position', 'selection'].includes(key)) && fields.every(key => typeof draft[key] === 'string') && [...captureKinds, 'image', 'audio', 'video', 'pdf'].includes(draft.kind) && draft.id.length <= 512 && /^material-[a-zA-Z0-9-]+$/.test(draft.id) && (!draft.canvasId || /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(draft.canvasId)) && (draft.position === null || Boolean(draft.position && Number.isFinite(draft.position.x) && Number.isFinite(draft.position.y))) && (draft.selection === null || Boolean(draft.selection && Number.isSafeInteger(draft.selection.start) && Number.isSafeInteger(draft.selection.end)));
}
export function MaterialDraftRecovery({ raw, onExport, onRestart, onClose }: { raw: string; onExport: () => void; onRestart: () => void; onClose: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  return <WorkbenchModal title="材料草稿需要恢复" onClose={onClose}><div className="wb-editor">
    <p>这份本地记录的格式无法识别，没有覆盖原记录，也没有把它当成空草稿。已保存的材料和画布不受影响。</p>
    <label>原始草稿记录<textarea aria-label="原始草稿记录" readOnly rows={6} value={raw} /></label>
    <button className="wb-button" onClick={onExport}>导出原始草稿记录</button>
    <p className="wb-muted">导出只会发起下载，请自行核实文件并保留需要的内容；点击导出不代表已经备份成功。</p>
    <label className="wb-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我已自行保留需要的内容，允许重新开始</label>
    <div className="wb-actions"><button className="wb-button" onClick={onClose}>继续保留，不改草稿</button><button className="wb-button wb-primary" disabled={!confirmed} onClick={onRestart}>重新开始材料草稿</button></div>
  </div></WorkbenchModal>;
}
export function MaterialCapture({ source, draft, onChange, onSave, onClose, client, saved, pending }: { source?: CaptureSource; draft: CaptureDraft; onChange: (value: CaptureDraft) => void; onSave: (plan: CapturePlan) => Promise<void>; onClose: () => void; client: WorkbenchClient; saved: boolean; pending: boolean }) {
  const text = useRef<HTMLTextAreaElement>(null), latest = useRef({ draft, onChange }); latest.current = { draft, onChange };
  const [url, setUrl] = useState(''), [readError, setReadError] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [duration, setDuration] = useState(NaN), [pages, setPages] = useState(0);
  const textual = captureKinds.includes(draft.kind), field = (name: keyof CaptureDraft, value: string) => { setError(''); onChange({ ...draft, [name]: value }); };
  useEffect(() => {
    if (!source?.value.resourceId) return; let active = true;
    void (async () => { const id = source.value.resourceId, localUrl = await client.resourceUrl(id); if (!active) return; setUrl(localUrl);
      if (captureKinds.includes(source.entry.kind)) { const blob = await client.readResource(id); if (blob.size > 1_000_000) throw Error('原文超过当前摘取上限，请先取得所需局部；完整原件仍保留。'); const original = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await blob.arrayBuffer()); if (active) latest.current.onChange({ ...latest.current.draft, original }); }
    })().catch(cause => { if (active) setReadError(cause.message || '原件无法读取，未创建替代材料。'); });
    return () => { active = false; };
  }, [source?.value.resourceId, client]);
  const rectangle = { x: draft.x, y: draft.y, width: draft.width, height: draft.height };
  let region: ContentValue['origin']['locator'] | undefined;
  try { if (draft.kind === 'pdf') region = pdfLocator(draft.page, rectangle, draft.rotation, pages); else if (draft.kind === 'image') region = { type: 'image', rect: percentRect(rectangle) }; } catch { /* Invalid form input remains visible; save reports it. */ }
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setError(''); setBusy(true);
    try {
      if (readError) throw Error(readError);
      let plan: CapturePlan;
      if (textual) { const value = textCapture({ kind: draft.kind, title: draft.title, original: draft.original, url: draft.url, selection: draft.selection }); plan = { id: draft.id, ...value, ...(source?.value.resourceId ? { resourceId: source.value.resourceId, origin: { ...source.value.origin, ...(value.origin.url ? { url: value.origin.url } : {}), ...(value.origin.locator ? { locator: value.origin.locator } : { locator: undefined }) } } : { original: draft.original }) }; if (plan.origin.locator === undefined) delete plan.origin.locator; }
      else { if (!source?.value.resourceId || !url) throw Error('原件尚未读取，未猜测来源。'); const locator = draft.kind === 'pdf' ? pdfLocator(draft.page, rectangle, draft.rotation, pages) : draft.kind === 'image' ? { type: 'image', rect: percentRect(rectangle) } : timeLocator(draft.start, draft.end, duration); plan = { id: draft.id, kind: draft.kind, title: draft.title.trim() || source.entry.title + ' 摘录', text: source.value.text || '', resourceId: source.value.resourceId, origin: { ...source.value.origin, locator } }; }
      await onSave(plan);
    } catch (cause) { setError(cause.message || '材料尚未保存；草稿仍保留。'); } finally { setBusy(false); }
  };
  const measured = (element: HTMLMediaElement) => { const value = element.duration; setDuration(value); if (Number.isFinite(value)) setError(''); if (Number.isFinite(value) && !latest.current.draft.end) latest.current.onChange({ ...latest.current.draft, end: String(Math.round(value * 1000) / 1000) }); };
  return <WorkbenchModal title={source ? '从原件摘取线索' : '留下材料'} onClose={onClose}><form className="wb-editor wb-capture" aria-label="材料摘取与来源" onSubmit={event => { void submit(event); }}>
    <p className="wb-muted">{source ? '只新增一条引用同一原件的摘录，不修改原件，也不替换已有线索。' : '留下原文和来源；可以只取一段。不会自动抓取网页、填充 AI 解释或覆盖你的表达。'}</p><p className="wb-muted">目标画布（准备时名称）：{draft.canvasTitle || draft.canvasId}</p>
    {saved && <p role="status">材料正文已保留，尚未完成放置时只重试原画布布局，不重复创建材料。</p>}
    {pending && <p role="status">上一操作尚未确认。可关闭此窗口保留草稿，在工作台核对原命令后继续。</p>}
    <fieldset disabled={busy || saved || pending}>
      {!source && <label>材料类型<select aria-label="材料类型" value={draft.kind} onChange={e => field('kind', e.target.value)}><option value="text">文字材料</option><option value="dialogue">对话片段</option><option value="code">代码片段</option><option value="web">网页摘录</option></select></label>}
      <label>材料标题<input aria-label="材料标题" value={draft.title} onChange={e => field('title', e.target.value)} /></label>
      {textual && <>
        <label>{draft.kind === 'web' ? '原网页地址（必填）' : '来源地址（可选）'}<input aria-label="来源地址" value={draft.url} onChange={e => field('url', e.target.value)} placeholder={draft.kind === 'web' ? '网页摘录需提供完整的 https:// 地址' : '没有外部地址也可保留原文'} readOnly={Boolean(source)} /></label>
        <label>完整原文<textarea ref={text} aria-label="完整原文" rows={7} value={draft.original} readOnly={Boolean(source)} onChange={e => { setError(''); onChange({ ...draft, original: e.target.value, selection: null }); }} /></label>
        <div className="wb-actions"><button type="button" className="wb-button" onClick={() => { const element = text.current; if (element && element.selectionEnd > element.selectionStart) { setError(''); onChange({ ...draft, selection: { start: element.selectionStart, end: element.selectionEnd } }); } else setError('请先选中原文中要留下的片段。'); }}>使用原文中的选段</button>{draft.selection && <button type="button" className="wb-button" onClick={() => { setError(''); onChange({ ...draft, selection: null }); }}>改为保留全文</button>}</div>
        <p className="wb-muted">{draft.selection ? locatorLabel({ type: 'text', ...draft.selection }) : '保留全文'}；原文另存为不可变原件。</p>
        <pre className="wb-capture-excerpt" aria-label="摘录预览">{draft.selection ? draft.original.slice(draft.selection.start, draft.selection.end) : draft.original || '还没有输入原文。'}</pre>
      </>}
      {source && ['audio', 'video'].includes(draft.kind) && <>
        {url && (draft.kind === 'video' ? <video className="wb-media-video" src={url} controls preload="metadata" onLoadedMetadata={e => measured(e.currentTarget)} onError={() => setReadError('原视频无法解码；原件仍保留，没有记录虚构时长。')} /> : <audio className="wb-media-audio" src={url} controls preload="metadata" onLoadedMetadata={e => measured(e.currentTarget)} onError={() => setReadError('原音频无法解码；原件仍保留，没有记录虚构时长。')} />)}
        <p className="wb-muted">{Number.isFinite(duration) ? `实际原件时长 ${duration.toFixed(3)} 秒` : '正在读取真实时长…'}</p>
        <div className="wb-locator-grid"><label>开始时间（秒）<input aria-label="开始时间（秒）" inputMode="decimal" value={draft.start} onChange={e => field('start', e.target.value)} /></label><label>结束时间（秒）<input aria-label="结束时间（秒）" inputMode="decimal" value={draft.end} onChange={e => field('end', e.target.value)} /></label></div>
      </>}
      {source && ['pdf', 'image'].includes(draft.kind) && <>
        {draft.kind === 'pdf' && <div className="wb-locator-grid"><label>PDF 页码<input aria-label="PDF 页码" inputMode="numeric" value={draft.page} onChange={e => field('page', e.target.value)} /></label><label>页面旋转<select aria-label="页面旋转" value={draft.rotation} onChange={e => field('rotation', e.target.value)}>{[0, 90, 180, 270].map(n => <option key={n} value={n}>{n}°</option>)}</select></label></div>}
        <p className="wb-muted">区域以所示页面左上角为起点，百分比在 0–100 内；旋转后的页面坐标独立记录。</p>
        <div className="wb-locator-grid">{([['x', '区域左侧（%）'], ['y', '区域顶部（%）'], ['width', '区域宽度（%）'], ['height', '区域高度（%）']] as const).map(([key, label]) => <label key={key}>{label}<input aria-label={label} inputMode="decimal" value={draft[key]} onChange={e => field(key, e.target.value)} /></label>)}</div>
        {url && (draft.kind === 'pdf' ? /^\d+$/.test(draft.page) && Number(draft.page) > 0 ? <Suspense fallback={<p role="status">正在准备 PDF 定位…</p>}><PdfPreview url={url} locator={region || { type: 'pdf', page: Number(draft.page), rotation: [0, 90, 180, 270].includes(Number(draft.rotation)) ? Number(draft.rotation) : 0 }} fullPage onInfo={value => setPages(value.pages)} onDocumentError={setReadError} /></Suspense> : <p role="status">填写有效页码后显示对应原页，不会改跳到其它位置。</p> : <LocalMedia kind="image" url={url} title={draft.title} locator={region} original />)}
      </>}
    </fieldset>
    <div className="wb-actions">{(readError || error) && <p role="alert" className="wb-capture-error">{readError || error}</p>}<button type="button" className="wb-button" onClick={onClose}>取消，保留草稿</button><button type="submit" className="wb-button wb-primary" disabled={busy || pending}>{busy ? '正在保存材料与布局…' : saved ? '重试放到原画布' : '保存材料并放到画布'}</button></div>
  </form></WorkbenchModal>;
}
