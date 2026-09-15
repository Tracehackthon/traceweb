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
      <div className="video-copy"><p>Trace 视频展示</p><h1 id="video-title">从一次停住，<br/>到结果<span>回来。</span></h1><p>这个路由已经固定留出。视频文件上线后，会在同一地址直接播放，不改变产品介绍页和完整桌面端的入口。</p></div>
      <div className="video-frame" data-state={available === null ? 'loading' : available ? 'ready' : 'empty'}>
        {available ? <video controls preload="metadata" poster="/evidence/trace-worksite.webp"><source src="/video/trace-demo.mp4" type="video/mp4"/>你的浏览器不支持视频播放。</video> : <div className="video-placeholder" role="status"><div className="video-play" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M18 13.5 35 24 18 34.5Z"/></svg></div><strong>{available === null ? '正在确认视频资源…' : '视频位置已经准备好'}</strong><p>{available === null ? '稍等片刻。' : '将 MP4 放到 apps/web/public/video/trace-demo.mp4 后，这里会自动切换为播放器。'}</p></div>}
      </div>
    </section>
    <footer><p>视频不会替代可操作的演示。</p><a href="/app/demo">直接体验六个动作 →</a></footer>
  </main>;
}

const mountPoint = document.querySelector('#app');
if (!mountPoint) throw new Error('Trace 视频页缺少 #app 挂载点');
createRoot(mountPoint).render(<VideoPage/>);
