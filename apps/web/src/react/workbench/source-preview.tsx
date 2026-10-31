import {HaloNotice,HaloProgress} from './halo-surfaces';
import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { WorkbenchModal } from './modal';
import { TraceIcon } from '../ui/icon';
import { WorkbenchClient, type ContentEntry, type ContentValue } from './client';
import { locatorLabel } from './source-locator.mjs';
export const PdfPreview = lazy(() => import('./pdf-preview'));
type Locator = NonNullable<NonNullable<ContentValue['origin']>['locator']>;

export function LocalMedia({ kind, url, title, locator, original = false }: { kind: string; url: string; title: string; locator?: Locator; original?: boolean }) {
  const media = useRef<HTMLMediaElement>(null), [error, setError] = useState(''), [imageRatio, setImageRatio] = useState(1),[attempt,setAttempt]=useState(0);
  const clip = locator?.type === 'time' ? { start: Number(locator.startMs) / 1000, end: Number(locator.endMs) / 1000 } : null;
  const rect = locator?.type === 'image' ? locator.rect as { x: number; y: number; width: number; height: number } : null;
  const start = (element: HTMLMediaElement) => {
    if (clip && Number.isFinite(element.duration) && clip.end > element.duration + .001) { setError('已记录的片段范围超出可读取原件；摘录未被替换。'); return; }
    if (clip) element.currentTime = clip.start;
  };
  // Do not start a second seek from `seeking`: Electron can keep the first
  // seek pending while resuming a metadata-preloaded local Blob. Correct only
  // after `seeked`; pause out-of-range scrubbing without rewriting its target.
  const props = { src: url, controls: true, preload: 'metadata', 'data-canvas-no-zoom': true, onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) => start(e.currentTarget), onError: () => setError('当前原件无法播放；已保存的来源和摘录仍保留。'), onPlay: (e: React.SyntheticEvent<HTMLMediaElement>) => { if (clip && !original && (e.currentTarget.currentTime < clip.start || e.currentTarget.currentTime >= clip.end)) e.currentTarget.currentTime = clip.start; }, onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) => { if (e.currentTarget.seeking) return; if (clip && !original && e.currentTarget.currentTime >= clip.end) { e.currentTarget.pause(); if (Math.abs(e.currentTarget.currentTime - clip.end) > .001) e.currentTarget.currentTime = clip.end; } }, onSeeking: (e: React.SyntheticEvent<HTMLMediaElement>) => { if (clip && !original && (e.currentTarget.currentTime < clip.start || e.currentTarget.currentTime > clip.end)) e.currentTarget.pause(); }, onSeeked: (e: React.SyntheticEvent<HTMLMediaElement>) => { if (clip && !original && (e.currentTarget.currentTime < clip.start || e.currentTarget.currentTime > clip.end)) e.currentTarget.currentTime = Math.min(clip.end, Math.max(clip.start, e.currentTarget.currentTime)); } };
  return <div className="wb-local-media" data-source-locator={locator?.type || 'whole'}>
    {error && <HaloNotice tone="error" title="原件读取未完成" description={error} actions={<button className="wb-button" onClick={()=>{setError('');setAttempt(n=>n+1);}}>重试读取原件</button>}/>}
    {kind === 'image' && <div className={'wb-image-region ' + (rect && !original ? 'is-cropped' : '')} style={rect && !original ? { aspectRatio: String(imageRatio * rect.width / rect.height) } : undefined}>
      <img key={attempt} className="wb-media-image" src={url} alt={title} draggable={false} onLoad={e => setImageRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} onError={() => setError('图片原件无法解码；已记录的来源仍保留。')} style={rect && !original ? { position: 'absolute', width: 100 / rect.width + '%', maxHeight: 'none', left: -rect.x / rect.width * 100 + '%', top: -rect.y / rect.height * 100 + '%' } : undefined} />
      {rect && original && <span className="wb-source-region" aria-label="原图片中的摘取区域" style={{ left: rect.x * 100 + '%', top: rect.y * 100 + '%', width: rect.width * 100 + '%', height: rect.height * 100 + '%' }} />}
    </div>}
    {kind === 'video' && <video key={attempt} ref={element => { media.current = element; }} className="wb-media-video" {...props} />}
    {kind === 'audio' && <audio key={attempt} ref={element => { media.current = element; }} className="wb-media-audio" {...props} />}
    {kind === 'pdf' && <Suspense fallback={<p className="wb-muted" role="status">正在准备本地 PDF 渲染…</p>}><PdfPreview url={url} locator={locator} fullPage={original} /></Suspense>}
    {clip && original && <button className="wb-button" onClick={() => { if (media.current) { media.current.pause(); start(media.current); media.current.focus(); } }}>回到摘取位置，{locatorLabel(locator)}</button>}
  </div>;
}
export function MaterialPreview({ entry, value, client,compact=false }: { entry: ContentEntry; value: ContentValue; client: WorkbenchClient; compact?: boolean }) {
  const [url, setUrl] = useState<string | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => { let active = true; setUrl(null); setError(''); if (value.resourceId) void client.resourceUrl(value.resourceId).then(value => { if (active) setUrl(value); }, cause => { if (active) setError(cause.message); }); return () => { active = false; }; }, [value.resourceId, client, attempt]);
  if (!value.resourceId) return null;
  if (error) return <div className="wb-media-missing"><HaloNotice tone={compact?"warning":"error"} compact={compact} title="原件暂时不可用" description={compact?undefined:error} actions={compact?undefined:<button className="wb-button" onClick={() => setAttempt(n => n + 1)}>重试读取这份原件</button>}/></div>;
  if (!url) return <HaloProgress label="正在读取本地原件…"/>;
  if (!['image', 'audio', 'video', 'pdf'].includes(entry.kind)) return null;
  return <LocalMedia key={value.resourceId} kind={entry.kind} url={url} title={entry.title} locator={value.origin?.locator} />;
}
function OriginalText({ text, locator }: { text: string; locator?: Locator }) {
  const mark = useRef<HTMLElement>(null);
  useEffect(() => { mark.current?.scrollIntoView({ block: 'center' }); }, [text, locator?.start, locator?.end]);
  const start = locator?.type === 'text' ? Number(locator.start) : 0, end = locator?.type === 'text' ? Number(locator.end) : 0;
  if (start < 0 || end > text.length || end < start) return <p role="status">已记录选段超出原件；没有改选其它位置。</p>;
  return <pre className="wb-original-text" aria-label="完整原文与摘取位置">{end > start ? <>{text.slice(0, start)}<mark ref={mark}>{text.slice(start, end)}</mark>{text.slice(end)}</> : text}</pre>;
}
export function OriginalViewer({ entry, value, client, onClose }: { entry: ContentEntry; value: ContentValue; client: WorkbenchClient; onClose: () => void }) {
  const [url, setUrl] = useState(''), [text, setText] = useState<string | null>(null), [error, setError] = useState(''), [downloadError, setDownloadError] = useState(''),[attempt,setAttempt]=useState(0),[downloading,setDownloading]=useState(false);
  useEffect(() => { let active = true;setError('');setUrl('');setText(null); void (async () => {
    if (!value.resourceId) throw Error('没有保存本地原件；原网页地址和已有摘录仍可保留。');
    const url = await client.resourceUrl(value.resourceId); if (!active) return;
    setUrl(url);
    if (['text', 'web', 'dialogue', 'code'].includes(entry.kind)) {
      const blob = await client.readResource(value.resourceId);
      if (blob.size > 1_000_000) throw Error('原文超过当前内联预览上限，可下载完整原件；摘录未被改动。');
      const original = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await blob.arrayBuffer()); if (active) setText(original);
    }
  })().catch(cause => { if (active) setError(cause.message || '原件读取失败，摘录仍保留。'); }); return () => { active = false; }; }, [client, value.resourceId, entry.kind,attempt]);
  const download = async () => {setDownloadError('');setDownloading(true); try { const href = url || (value.resourceId ? await client.resourceUrl(value.resourceId) : ''); if (!href) throw Error('没有可下载的本地原件。'); const a = document.createElement('a'); a.href = href; a.download = value.origin?.fileName || entry.title; a.click(); } catch (cause) { setDownloadError(cause.message); }finally{setDownloading(false);} };
  return <WorkbenchModal title="原件与摘取位置" onClose={onClose}><p className="wb-muted">{entry.title}，{locatorLabel(value.origin?.locator)}。原件只读，自己的摘记不会覆盖它。</p>
    {error && <HaloNotice tone="error" title="原件读取未完成" description={error} actions={value.resourceId?<button className="wb-button" onClick={()=>setAttempt(n=>n+1)}>重试读取原件</button>:undefined}/>}
    {url && <LocalMedia kind={entry.kind} title={entry.title} url={url} locator={value.origin?.locator} original />}
    {text !== null && <OriginalText text={text} locator={value.origin?.locator} />}
    {!url && !error && <HaloProgress label="正在读取原件…"/>}
    <div className="wb-actions">{value.origin?.url && <a className="wb-button" href={value.origin.url} target="_blank" rel="noopener noreferrer">打开原网页</a>}{value.resourceId && <button className="wb-button" disabled={downloading} aria-busy={downloading} onClick={() => { void download(); }}>下载原件</button>}<button className="wb-button wb-primary" onClick={onClose}>返回线索</button></div>{downloading?<HaloProgress label="正在准备原件下载…"/>:downloadError&&<HaloNotice tone="error" title="原件下载未完成" description={downloadError}/>}
  </WorkbenchModal>;
}
