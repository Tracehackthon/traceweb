import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const repository = 'https://github.com/Tracehackthon/trace_backend';
const desktopRelease = 'https://github.com/Tracehackthon/traceweb/releases/latest';
const zhihuSource = 'https://www.zhihu.com/question/585059015/answer/2076093417847898217';

type IconName = 'arrow' | 'external' | 'code' | 'play' | 'menu' | 'close' | 'check';
const paths: Record<IconName, React.ReactNode> = {
  arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
  external: <><path d="M14 4h6v6"/><path d="m10 14 10-10"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></>,
  code: <><path d="m9 18-6-6 6-6"/><path d="m15 6 6 6-6 6"/></>,
  play: <path d="m9 7 8 5-8 5Z"/>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
  close: <><path d="m6 6 12 12M18 6 6 18"/></>,
  check: <path d="m5 12 4 4 10-10"/>,
};

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <a className="site-brand" href="#main" aria-label="Trace 首页"><img src="/brand/trace-app-icon-64.png" width="38" height="38" alt=""/><b>Trace</b>{!compact && <span>让思考，有后续</span>}</a>;
}

function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 40);
    update(); window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  return <header className={`site-header${scrolled ? ' is-scrolled' : ''}`}>
    <Brand/>
    <nav className={open ? 'is-open' : ''} aria-label="页面导航">
      <a href="#proof" onClick={() => setOpen(false)}>真实链路</a>
      <a href="#pet" onClick={() => setOpen(false)}>桌宠</a>
      <a href="/video" onClick={() => setOpen(false)}>演示</a>
      <a href={repository} onClick={() => setOpen(false)}>GitHub</a>
    </nav>
    <a className="header-cta" href="/app/demo">体验真实 Demo <Icon name="arrow" size={15}/></a>
    <button className="menu-toggle" type="button" aria-label={open ? '关闭导航' : '打开导航'} aria-expanded={open} onClick={() => setOpen(v => !v)}><Icon name={open ? 'close' : 'menu'}/></button>
  </header>;
}

function Hero() {
  return <section className="intro-hero" aria-labelledby="opening-title">
    <div className="hero-copy">
      <p className="hero-eyebrow"><span/>一件仍在变化的事</p>
      <h1 id="opening-title">把此刻的<br/><em>一点，</em><br/>带到以后。</h1>
      <p className="hero-lede">从知乎的一句话，到真正做完的工作。Trace 保留来源、判断与结果，让问题在你正在使用的原生 Agent 里继续。</p>
      <div className="hero-actions"><a className="primary-action" href="/app/demo">带一个问题来试试 <Icon name="arrow"/></a><a href="#proof">看这件事怎样继续 <Icon name="arrow" size={15}/></a></div>
    </div>
    <figure className="hero-product">
      <img data-critical="true" src="/showcase/trace-resume-matter.webp" alt="Trace 重新接续一件还没想完的事" fetchPriority="high" decoding="async"/>
      <figcaption><span><i/>真实产品画面</span><b>从上次停下的地方继续</b></figcaption>
    </figure>
    <article className="hero-source-card"><span>知乎公开内容</span><b>“很多收藏没有被回看，不一定是因为懒。”</b><small>拾光者 · 标题与摘要可核对</small></article>
    <img className="hero-pet" src="/real/trace-desktop-pet.png" alt="" aria-hidden="true"/>
    <svg className="hero-path" viewBox="0 0 1200 500" preserveAspectRatio="none" aria-hidden="true"><path d="M-20 330 C170 220 295 420 445 290 S700 120 835 250 S1040 395 1230 210"/><circle cx="445" cy="290" r="6"/><circle cx="835" cy="250" r="6"/><circle className="return-node" cx="1185" cy="226" r="9"/></svg>
    <div className="hero-proof-line"><span>知乎真实来源</span><i/><span>桌宠先接住</span><i/><span>原生 Agent</span><i/><span>结果回来</span></div>
  </section>;
}

const stages = [
  { key: 'source', no: '01', label: '知乎来源', title: '先看见真实经验，再决定它与我有什么关系。', body: '公开内容保留标题、作者、摘要和原文入口。它可以支持、挑战或限制当前判断，但不会自动成为你的立场。', image: '/showcase/trace-zhihu-source.webp', alt: 'Trace 中可核对的知乎公开内容摘要', proof: '知乎公开内容 · 拾光者 · 2026/9/15' },
  { key: 'capture', no: '02', label: '接住这一点', title: '不必先整理成结论，也不用离开眼前的工作。', body: '刘看山留在桌边，接住原话、来处和当时的停点。需要时再展开，不用时安静退回边缘。', image: '/showcase/trace-matter-continuity.webp', alt: 'Trace 保留原表达、知乎来源与当前停点', proof: '原话已留下 · 来源仍可核对' },
  { key: 'agent', no: '03', label: '带去工作', title: '工作不必搬家，继续使用你原来的 Agent。', body: 'Trace 不重做一个孤立 Agent。它把原话、当前判断和尚未确认的部分带给 Codex 等原生 Agent，再接回真实结果。', image: '/showcase/desktop-agent-panel-public.webp', alt: 'Trace 在 Codex 原生工作现场展开交接，宿主界面内容已经隐去', proof: '当前首先完整适配 Codex · 支持 Codex Harness 与自定义 Agent' },
  { key: 'return', no: '04', label: '结果回来', title: '做过以后，再决定原来的判断要不要改变。', body: '事实、产物与未解决的部分回到原问题。只有经过你确认，新的理解才会影响下一次接续。', image: '/showcase/trace-result-detail.webp', alt: 'Trace 结果复核界面', proof: '已带回 · 待确认' },
] as const;

function EvidenceTheatre() {
  const [active, setActive] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const stage = stages[active];
  return <section className="proof-section" id="proof" aria-labelledby="proof-title">
    <header className="proof-heading" data-reveal><p>一次真实接续</p><h2 id="proof-title">同一个问题，走过四个现场。</h2><span>不是四项独立功能，而是同一件事怎样从来源走到实践，再带着结果回来。</span></header>
    <div className="proof-theatre" data-stage={stage.key} data-reveal>
      <nav aria-label="选择真实产品阶段">{stages.map((item, index) => <button key={item.key} type="button" className={active === index ? 'is-active' : ''} aria-pressed={active === index} onClick={() => setActive(index)}><span>{item.no}</span><b>{item.label}</b><small>{item.title}</small></button>)}</nav>
      <div className="proof-copy"><span>{stage.no} / {stage.label}</span><h3>{stage.title}</h3><p>{stage.body}</p>{stage.key === 'source' && <a href={zhihuSource} target="_blank" rel="noreferrer">查看知乎原文 <Icon name="external" size={14}/></a>}</div>
      <figure className="proof-media"><div className="media-bar"><span><i/><i/><i/></span><b>{stage.proof}</b></div><img key={stage.image} data-critical="true" src={stage.image} alt={stage.alt} loading="lazy" decoding="async"/>{stage.key === 'agent' && <div className="agent-mask" aria-hidden="true"/>}<figcaption>{stage.proof}</figcaption></figure>
      {stage.key === 'return' && <div className={`result-diff${confirmed ? ' is-confirmed' : ''}`}><article><small>之前</small><p>保存以后，常常再也接不回当时的问题。</p></article><i/><article><small>后来</small><p>具体任务也可能成为重新进入问题的新线索。</p></article><button type="button" onClick={() => setConfirmed(v => !v)}><Icon name="check" size={15}/>{confirmed ? '已确认这次变化' : '确认这次变化'}</button></div>}
    </div>
  </section>;
}

const petStates = [
  { image: '/showcase/desktop-pet-quiet.jpg', label: '待在桌边', note: '不挡住正在看的内容' },
  { image: '/showcase/desktop-pet-input.jpg', label: '先接住', note: '一句话也可以留下' },
  { image: '/showcase/desktop-pet-saved.jpg', label: '以后再继续', note: '原话与停点都还在' },
] as const;

function PetSection() {
  const [active, setActive] = useState(1);
  const strip = useRef<HTMLDivElement | null>(null);
  return <section className="pet-section" id="pet" aria-labelledby="pet-title">
    <header data-reveal><p>刘看山桌宠</p><h2 id="pet-title">不占据工作。<br/>只在你需要时出现。</h2><span>这三张不是概念图，而是桌面端同一次真实捕获的前后状态。</span></header>
    <div className="pet-stage" data-reveal>
      <div className="pet-strip" ref={strip}>{petStates.map((item, index) => <figure key={item.label} className={active === index ? 'is-active' : ''} onMouseEnter={() => setActive(index)}><div><img src={item.image} alt={`Trace 桌宠：${item.label}`} loading="lazy" decoding="async"/></div><figcaption><span>0{index + 1}</span><b>{item.label}</b><small>{item.note}</small></figcaption></figure>)}</div>
      <img className="pet-character" src="/real/trace-desktop-pet.png" alt="Trace 刘看山桌宠"/>
      <p className="pet-caption">点一下，留下此刻为什么在意。<br/>其余时间，它回到桌边。</p>
    </div>
  </section>;
}

function WaysToUse() {
  return <section className="ways" id="use" aria-labelledby="ways-title">
    <header data-reveal><p>现在可以怎样用</p><h2 id="ways-title">先带一个真正想继续的问题来。</h2></header>
    <div className="way-list" data-reveal>
      <a href="/app/demo"><span>01</span><div><small>用完整示例先看一遍</small><h3>在线演示</h3><p>知乎来源、讨论、Agent 交接与结果都可以打开核对。</p></div><Icon name="arrow"/></a>
      <a href="/app"><span>02</span><div><small>内容只留在当前浏览器</small><h3>个人 Web 空间</h3><p>从自己的一个问题开始，体验接住、对照与回看。</p></div><Icon name="arrow"/></a>
      <a href={desktopRelease}><span>03</span><div><small>进入真实工作现场</small><h3>Windows 桌面版</h3><p>连接知乎授权、本机 Bridge 与正在使用的原生 Agent。</p></div><Icon name="external"/></a>
    </div>
    <div className="fact-line" data-reveal><span>内容优先留在本机或当前浏览器</span><span>公开检索与知乎账号授权分开</span><span>来源不会自动成为你的判断</span><span>当前没有 Trace 云账号与跨设备同步</span></div>
  </section>;
}

function Closing() {
  return <section className="site-closing" aria-labelledby="closing-title">
    <svg viewBox="0 0 1200 240" preserveAspectRatio="none" aria-hidden="true"><path d="M-20 150 C220 50 310 210 520 120 S780 54 930 150 S1100 152 1230 70"/><circle cx="520" cy="120" r="6"/><circle cx="930" cy="150" r="6"/><circle className="last-node" cx="1200" cy="84" r="10"/></svg>
    <div className="closing-ticket" data-reveal><span>这次已经接回</span><b>来源、判断与工作结果</b><small>都回到了原问题旁边</small></div>
    <img src="/real/trace-desktop-pet.png" alt="Trace 刘看山桌宠" loading="lazy" decoding="async"/>
    <h2 id="closing-title" data-reveal>下一次，<br/>不必从头解释。</h2>
    <div className="closing-actions" data-reveal><a className="primary-action" href="/app/demo">带一个问题来试试 <Icon name="arrow"/></a><a href={repository}><Icon name="code" size={15}/> GitHub</a></div>
  </section>;
}

function IntroApp() {
  useEffect(() => {
    document.body.className = 'intro-page';
    document.title = 'Trace · 把此刻的一点，带到以后';
    const items = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (!('IntersectionObserver' in window)) {
      items.forEach((item) => item.classList.add('is-in'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -8% 0px' });
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);
  return <><a className="intro-skip" href="#main">跳到正文</a><SiteHeader/><main id="main"><Hero/><EvidenceTheatre/><PetSection/><WaysToUse/><Closing/></main><footer className="site-footer"><Brand compact/><p>把想过的、做过的，继续接起来。</p><nav><a href="/app/demo">演示</a><a href="/video">视频</a><a href={repository}>GitHub</a></nav></footer></>;
}

const mountPoint = document.querySelector('#app');
if (!mountPoint) throw new Error('Trace 产品介绍缺少 #app 挂载点');
createRoot(mountPoint).render(<IntroApp/>);
