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
      <div className="video-copy"><p>Trace 真实使用记录</p><h1 id="video-title">从桌宠接住现场，<br/>到结果<span>回来。</span></h1><p>41 秒实录来自当前运行中的 Trace 桌面端与桌宠：记录一段思考、检索知乎公开内容，再把它交给 Local Codex，最后带回可继续判断的工作结果。</p></div>
      <div className="video-frame" data-state={available === null ? 'loading' : available ? 'ready' : 'empty'}>
        {available ? <video controls preload="metadata" playsInline poster="/video/trace-demo-poster.jpg"><source src="/video/trace-demo.mp4" type="video/mp4"/>你的浏览器不支持视频播放。</video> : <div className="video-placeholder" role="status"><div className="video-play" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M18 13.5 35 24 18 34.5Z"/></svg></div><strong>{available === null ? '正在确认视频资源…' : '视频暂时没有加载成功'}</strong><p>{available === null ? '稍等片刻。' : '请刷新页面重试，或先进入完整演示。'}</p></div>}
      </div>
    </section>
    <footer><p>视频来自真实本地链路；无关桌面细节已隐去。</p><a href="/app/demo">直接体验六个动作 →</a></footer>
  </main>;
}

const mountPoint = document.querySelector('#app');
if (!mountPoint) throw new Error('Trace 视频页缺少 #app 挂载点');
createRoot(mountPoint).render(<VideoPage/>);
