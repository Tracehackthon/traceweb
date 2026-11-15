// PDF.js owns page decoding only; the Infinite Canvas camera, content identity,
// reference and history remain with Trace. No viewer actions/forms/scripts.
import React, { useEffect, useRef, useState } from 'react';
import { AnnotationMode, getDocument, GlobalWorkerOptions, PDFWorker, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ContentValue } from './client';
import { locatorLabel } from './source-locator.mjs';

GlobalWorkerOptions.workerSrc = workerUrl;
const assetBase = '/assets/pdfjs-6.4.299/';
type Locator = NonNullable<NonNullable<ContentValue['origin']>['locator']>;
type Lease = { promise: Promise<PDFDocumentProxy>; users: number; dispose?: ReturnType<typeof setTimeout>; destroy: () => Promise<void> };
let worker: PDFWorker | undefined;
const documents = new Map<string, Lease>();
function acquire(url: string) {
  if (!url.startsWith('blob:')) throw Error('PDF只读取已保存的本地原件，不直接请求外部网址。');
  let lease = documents.get(url);
  if (!lease) {
    if (!worker || worker.destroyed) worker = PDFWorker.create({ name: 'trace-local-pdf' });
    const task = getDocument({ url, worker, cMapUrl: assetBase + 'cmaps/', cMapPacked: true, iccUrl: assetBase + 'iccs/', standardFontDataUrl: assetBase + 'standard_fonts/', wasmUrl: assetBase + 'wasm/', useSystemFonts: false, enableXfa: false, disableAutoFetch: true, disableStream: true, stopAtErrors: true, maxImageSize: 16_000_000, canvasMaxAreaInBytes: 16_000_000 });
    lease = { promise: task.promise, users: 0, destroy: () => task.destroy() };
    documents.set(url, lease);
  }
  if (lease.dispose) clearTimeout(lease.dispose);
  lease.users++;
  const current = lease;
  return { promise: current.promise, release: () => {
    current.users--;
    if (current.users === 0) current.dispose = setTimeout(() => {
      if (current.users === 0 && documents.get(url) === current) { documents.delete(url); void current.destroy().catch(() => {}); }
    }, 1000);
  } };
}
export default function PdfPreview({ url, locator, fullPage = false, onInfo, onDocumentError }: { url: string; locator?: Locator; fullPage?: boolean; onInfo?: (value: { pages: number }) => void; onDocumentError?: (message: string) => void }) {
  const box = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), info = useRef(onInfo), failed = useRef(onDocumentError); info.current = onInfo; failed.current = onDocumentError;
  const [visible, setVisible] = useState(false), [document, setDocument] = useState<PDFDocumentProxy | null>(null), [error, setError] = useState(''), [width, setWidth] = useState(320), [rendered, setRendered] = useState(false);
  const pageNumber = locator?.type === 'pdf' ? Number(locator.page) : 1, rotation = locator?.type === 'pdf' && locator.rotation !== undefined ? Number(locator.rotation) : undefined;
  const rect = locator?.type === 'pdf' ? locator.rect as { x: number; y: number; width: number; height: number } | undefined : undefined;
  useEffect(() => {
    const element = box.current; if (!element) return;
    const observer = new IntersectionObserver(entries => { setVisible(entries.some(entry => entry.isIntersecting)); }, { rootMargin: '200px' }); observer.observe(element);
    const resize = new ResizeObserver(entries => { const next = entries[0]?.contentRect.width; if (next > 0) setWidth(next); }); resize.observe(element);
    return () => { observer.disconnect(); resize.disconnect(); };
  }, []);
  useEffect(() => {
    if (!visible) { setDocument(null); setRendered(false); return; } let active = true;
    setDocument(null); setError(''); setRendered(false);
    let handle: ReturnType<typeof acquire>;
    try { handle = acquire(url); handle.promise.then(value => { if (active) { setDocument(value); info.current?.({ pages: value.numPages }); } }, cause => { if (active) { const message = cause.name === 'PasswordException' ? '原件已加密，需要先提供可读取的副本；没有猜测页面。' : 'PDF原件无法解析；已留下的摘录仍保留。'; setError(message); failed.current?.(message); } }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'PDF读取失败。'); }
    return () => { active = false; handle?.release(); };
  }, [url, visible]);
  useEffect(() => {
    if (!document || !canvas.current) return; let active = true, task: RenderTask | undefined;
    setRendered(false); setError('');
    void (async () => {
      if (pageNumber < 1 || pageNumber > document.numPages) throw Error(`定位页码超出原件的 ${document.numPages} 页，未改到其它页。`);
      const page = await document.getPage(pageNumber); if (!active) return;
      const base = page.getViewport({ scale: 1, ...(rotation === undefined ? {} : { rotation }) }), crop = !fullPage && rect ? rect : { x: 0, y: 0, width: 1, height: 1 };
      const ratio = Math.min(window.devicePixelRatio || 1, 2), scale = Math.min(width * ratio / (base.width * crop.width), Math.sqrt(4_000_000 / (base.width * base.height * crop.width * crop.height)), 4);
      const viewport = page.getViewport({ scale, ...(rotation === undefined ? {} : { rotation }) }), target = canvas.current;
      if (!target || !active) return;
      target.width = Math.max(1, Math.ceil(viewport.width * crop.width)); target.height = Math.max(1, Math.ceil(viewport.height * crop.height));
      task = page.render({ canvas: target, viewport, transform: [1, 0, 0, 1, -viewport.width * crop.x, -viewport.height * crop.y], annotationMode: AnnotationMode.DISABLE });
      await task.promise; if (active) setRendered(true);
    })().catch(cause => { if (active && cause.name !== 'RenderingCancelledException') setError(cause.message || '页面渲染失败，未替换定位。'); });
    return () => { active = false; task?.cancel(); };
  }, [document, pageNumber, rotation, rect?.x, rect?.y, rect?.width, rect?.height, fullPage, width]);
  return <div ref={box} className="wb-pdf-preview" data-pdf-status={error ? 'error' : rendered ? 'ready' : 'loading'} data-pdf-page={pageNumber}>
    {error && <p className="wb-media-missing" role="status">{error}</p>}
    {!error && !rendered && <p className="wb-muted" role="status">正在读取 PDF 页面…</p>}
    <div className="wb-pdf-page" hidden={!rendered || Boolean(error)}><canvas ref={canvas} role="img" aria-label={`PDF第 ${pageNumber} 页${!fullPage && rect ? '，已定位局部' : ''}`} />{fullPage && rect && <span className="wb-source-region" aria-label="原页面中的摘取区域" style={{ left: rect.x * 100 + '%', top: rect.y * 100 + '%', width: rect.width * 100 + '%', height: rect.height * 100 + '%' }} />}</div>
    <small>{locator?.type === 'pdf' ? locatorLabel(locator) : `第 ${pageNumber} 页`}{document ? ` / 共 ${document.numPages} 页` : ''}</small>
  </div>;
}
