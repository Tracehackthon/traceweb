import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

function VideoPage() {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    document.body.className = 'video-page';
    document.title = 'Trace · 视频展示';
    void fetch('/video/trace-demo.mp4', { method: 'HEAD', cache: 'no-store' })
      .then((response) => setAvailable(response.ok && (response.headers.get('content-type') || '').startsWith('video/')))
      .catch(() => setAvailable(false));
  }, []);
  return <main className="video-shell">
    <header><a href="/" className="video-brand"><span>t.</span>Trace</a><nav><a href="/">产品介绍</a><a href="/app/demo">完整演示</a><a href="/app">我的空间</a></nav></header>
    <section className="video-stage" aria-labelledby="video-title">
      <div className="video-copy"><h1 id="video-title">从桌宠接住现场，<br/>到结果<span>回来。</span></h1><p>这段演示记录了完整的一次接续：桌宠接住一句还没想清楚的话，结合知乎公开内容继续讨论，再交给 Codex 实践，最后把结果带回原来的问题。</p></div>
      <div className="video-frame" data-state={available === null ? 'loading' : available ? 'ready' : 'empty'}>
        {available ? <video controls preload="metadata" playsInline poster="/video/trace-demo-poster.jpg"><source src="/video/trace-demo.mp4" type="video/mp4"/>你的浏览器不支持视频播放。</video> : <div className="video-placeholder" role="status"><div className="video-play" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M18 13.5 35 24 18 34.5Z"/></svg></div><strong>{available === null ? '正在确认视频资源…' : '视频暂时没有加载成功'}</strong><p>{available === null ? '稍等片刻。' : '请刷新页面重试，或先进入完整演示。'}</p></div>}
      </div>
    </section>
    <footer><a href="/app/demo">体验完整演示 →</a></footer>
  </main>;
}

const mountPoint = document.querySelector('#app');
if (!mountPoint) throw new Error('Trace 视频页缺少 #app 挂载点');
createRoot(mountPoint).render(<VideoPage/>);
