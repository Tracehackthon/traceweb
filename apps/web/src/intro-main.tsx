import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const repository = 'https://github.com/Tracehackthon/trace_backend';
const zhihuSource = 'https://www.zhihu.com/question/1980227498164913662/answer/1981838969739178783';
const experience = '/app/demo';

type IconName = 'down' | 'right' | 'code' | 'external' | 'pointer';
const iconPaths: Record<IconName, React.ReactNode> = {
  down: <><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></>,
  right: <><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></>,
  code: <><path d="m9 18-6-6 6-6"/><path d="m15 6 6 6-6 6"/></>,
  external: <><path d="M15 3h6v6"/><path d="m10 14 11-11"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></>,
  pointer: <><path d="m3 3 7.5 17 2.4-7.1L20 10.5 3 3Z"/><path d="m13 13 5 5"/></>,
};

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name]}</svg>;
}

const overlayStates = [
  { id: 'quiet', label: '它先安静待着', hint: '边缘悬浮' },
  { id: 'input', label: '写下为什么停住', hint: '双击唤起' },
  { id: 'receipt', label: '留在原现场旁边', hint: '接住它' },
] as const;

function OriginEvidence() {
  const [active, setActive] = useState(0);
  const [manual, setManual] = useState(false);
  useEffect(() => {
    if (manual || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setActive((value) => (value + 1) % overlayStates.length), 3400);
    return () => window.clearInterval(timer);
  }, [manual]);
  return <figure className="origin-evidence">
    <div className="browser-chrome"><span className="traffic"><i/><i/><i/></span><span className="browser-address">zhihu.com / 一段真实阅读现场</span><a href={zhihuSource} target="_blank" rel="noreferrer" aria-label="打开知乎原文"><Icon name="external" size={15}/></a></div>
    <div className="origin-screen">
      <img className="origin-page" src="/evidence/zhihu-passage.webp" alt="知乎回答真实页面，其中写道任何需要手动建设的第二大脑都是伪命题"/>
      {overlayStates.map((state, index) => <img key={state.id} className="origin-overlay" data-kind={state.id} data-visible={index === active} src={`/evidence/overlay-${state.id}-crop.webp`} alt={index === active ? `真实 Trace Electron Overlay：${state.label}` : ''}/>)}
      <div className="source-focus" aria-hidden="true"><span>原文：手动建设的“第二大脑”都是伪命题</span></div><div className="truth-chip"><i/>真实知乎 · 段小草</div>
    </div>
    <figcaption>
      <div className="origin-controls" role="group" aria-label="查看桌面端出现形态">{overlayStates.map((state,index) => <button type="button" key={state.id} aria-pressed={active === index} onClick={() => {setActive(index);setManual(true);}}><span>0{index+1}</span><b>{state.label}</b><small>{state.hint}</small></button>)}</div>
      <p><Icon name="pointer" size={14}/>真实 Electron 叠层；演示文字由用户手工输入，当前不会自动读取网页选区。</p>
    </figcaption>
  </figure>;
}

const stages = [
  {title:'回来，不是翻收藏夹。', body:'原句、当时为什么在意，以及没想清的地方，仍在同一件事里。', proof:'真实 Trace Web · 同一事项', src:'/evidence/trace-matter.webp', position:'50% 50%', mobile:'64% 50%'},
  {title:'先写成自己的理解。', body:'外部材料和 Agent 建议都不会直接冒充你的判断；v1 是一次明确保存。', proof:'真实保存状态 · 我的理解 v1', src:'/evidence/trace-understanding-v1.webp', position:'48% 48%', mobile:'49% 50%'},
  {title:'只带这次真正需要的。', body:'Agent、项目、任务和内容范围都要在出发前核对。带去用，不等于已经起作用。', proof:'真实交接确认 · 目标已填写', src:'/evidence/trace-handoff.webp', position:'65% 48%', mobile:'82% 50%'},
  {title:'Agent 继续是工作主场。', body:'Trace 只把这次相关的上下文夹在旁边；当前外部 Agent 尚未连接，现场没有伪装成已领取。', proof:'真实工作现场 · connected=false', src:'/evidence/trace-worksite.webp', position:'50% 50%', mobile:'50% 50%'},
  {title:'结果先回来，别急着总结。', body:'事实、解释、仍未确认分别落位。这里是人工通过真实表单带回，不冒充 Agent 自动回传。', proof:'真实结果回流 · 等待复核', src:'/evidence/trace-returned.webp', position:'72% 48%', mobile:'84% 50%'},
  {title:'最后一票，始终在你手里。', body:'Trace 展示 v1 → v2 的具体差异。只有确认修改，新的理解才回到这件事。', proof:'真实复核弹窗 · 尚未确认', src:'/evidence/trace-review.webp', position:'50% 46%', mobile:'50% 50%'},
] as const;

function EvidenceJourney() {
  const section = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => setReduced(media.matches); onMotion(); media.addEventListener('change', onMotion);
    let raf = 0;
    const update = () => {
      raf = 0; const node = section.current; if (!node) return;
      const range = Math.max(1, node.offsetHeight - innerHeight);
      const passed = Math.min(range, Math.max(0, -node.getBoundingClientRect().top));
      setActive(Math.min(stages.length - 1, Math.floor((passed / range) * stages.length)));
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    update(); addEventListener('scroll', schedule, { passive: true }); addEventListener('resize', schedule);
    return () => { media.removeEventListener('change', onMotion); removeEventListener('scroll', schedule); removeEventListener('resize', schedule); cancelAnimationFrame(raf); };
  }, []);
  const go = (index: number) => {
    const node = section.current; if (!node) return;
    const top = scrollY + node.getBoundingClientRect().top;
    scrollTo({ top: top + (node.offsetHeight - innerHeight) * (index / (stages.length - 1)), behavior: reduced ? 'instant' : 'smooth' });
  };
  return <section className="evidence-journey" ref={section} aria-label="Trace 真实工作链路"><div className="journey-sticky">
    <div className="journey-screen"><div className="journey-slides">{stages.map((stage,index) => <img key={stage.src} className="journey-slide" data-visible={index === active} style={{objectPosition:stage.position}} src={stage.src} alt={index === active ? stage.proof : ''}/>)}</div><div className="journey-truth"><i/>真实 Trace Web 运行界面</div><div className="journey-mobile-image"><img style={{objectPosition:stages[active].mobile}} src={stages[active].src} alt={stages[active].proof}/></div></div>
    <div className="journey-panel"><p>0{active+1} / 06</p><h3>{stages[active].title}</h3><div className="journey-rule"><span style={{transform:`scaleX(${(active+1)/stages.length})`}}/></div><p>{stages[active].body}</p><b>{stages[active].proof}</b><div className="journey-dots" role="group" aria-label="跳到某个接续阶段">{stages.map((stage,index)=><button type="button" key={stage.title} aria-label={stage.title} aria-pressed={active===index} onClick={()=>go(index)}/>)}</div></div>
  </div></section>;
}

function ReturnSplice() {
  const [value, setValue] = useState(52);
  return <section className="return-splice" aria-label="我的理解从 v1 到 v2 的真实变化">
    <div className="splice-stage"><img src="/evidence/trace-understanding-v1.webp" alt="确认前的我的理解 v1"/><div className="splice-after" style={{clipPath:`inset(0 0 0 ${value}%)`}}><img src="/evidence/trace-understanding-v2.webp" alt="确认后的我的理解 v2"/></div><div className="splice-divider" style={{left:`${value}%`}} aria-hidden="true"><span>拖动</span></div><input aria-label="比较我的理解 v1 与 v2" type="range" min="12" max="88" value={value} onChange={event=>setValue(Number(event.target.value))}/><span className="splice-label splice-before-label">我的理解 · v1</span><span className="splice-label splice-after-label">确认后 · v2</span><img className="return-lens" src="/scene/return-lens-v1.png" alt="" aria-hidden="true"/></div>
    <div className="splice-notes"><p><b>没有自动覆盖</b><span>结果回来后，v1 仍保留；修改差异先摆在你面前。</span></p><p><b>没有混淆身份</b><span>事实、解释、建议和你的理解，各自保持来源。</span></p><p><b>确认才算改变</b><span>你明确复核后，同一件事才从 v1 继续到 v2。</span></p></div><p className="splice-proof">两侧均为真实 Trace Web 截图；测试内容由人工输入，v2 通过真实复核操作后保存。</p>
  </section>;
}

function IntroApp() {
  useEffect(() => { document.body.className = 'intro-page'; document.title = 'Trace · 让一件仍在变化的事继续发生'; }, []);
  return <><a className="skip-link" href="#main">跳到正文</a><header className="site-header"><a className="brand" href="#main" aria-label="Trace 产品介绍首页"><span>t.</span>Trace</a><nav aria-label="页面导航"><a href="#origin">原现场</a><a href="#journey">接续</a><a href="#return">回来</a><a href="/video">视频</a></nav><a className="header-cta" href={experience}>体验完整桌面端 <Icon name="right" size={16}/></a></header>
  <main id="main"><section className="opening" id="origin" aria-labelledby="opening-title"><div className="opening-copy"><p className="opening-index">TRACE / 01 · 触动发生的地方</p><h1 id="opening-title">别先收藏。<br/>先留下你<span>为什么停在这里。</span></h1><p>Trace 不是把网页搬进另一个仓库。它把你当时的触动留成一处停点，让这件事以后还能从原处继续。</p><a href="#how-it-continues">看它离开以后怎样继续 <Icon name="down" size={17}/></a></div><OriginEvidence/></section>
  <section className="thread-bridge" id="how-it-continues" aria-labelledby="bridge-title"><div className="bridge-copy"><p>这不是一条被归档的笔记</p><h2 id="bridge-title">保存，只是<span>起针。</span></h2><blockquote>“我真正担心的，不是要不要建设第二大脑，而是：离开这里以后，我还能不能接回此刻的判断？”</blockquote></div><div className="ribbon-stage" aria-hidden="true"><img src="/scene/continuity-ribbon-v1.png" alt=""/><span className="ribbon-label ribbon-label-a">原句</span><span className="ribbon-label ribbon-label-b">停点</span><span className="ribbon-label ribbon-label-c">后来</span></div><p className="bridge-note">同一件仍在变化的事，穿过阅读、理解和真实工作；不被拆成三份互不相干的记录。</p></section>
  <section className="journey-lead" id="journey" aria-labelledby="journey-title"><p>TRACE / 02 · 一件事如何继续</p><h2 id="journey-title">不靠回忆重演。<br/>每一次都从<span>上次真正停下的位置</span>开始。</h2><div className="journey-key" aria-label="内容身份"><span><i className="green"/>你的表达</span><span><i className="amber"/>外部材料与建议</span><span><i className="dark"/>真实工作结果</span></div></section><EvidenceJourney/>
  <section className="return-lead" id="return" aria-labelledby="return-title"><div><p>TRACE / 03 · 结果不是结论</p><h2 id="return-title">工作做完了。<br/>这件事还要<span>回来一次。</span></h2></div><p>事实、解释和仍未确认的部分先分开放。只有你明确复核以后，它们才会改变「我的理解」。</p></section><ReturnSplice/>
  <section className="forms-proof" aria-labelledby="forms-title"><div className="forms-copy"><p>TRACE / 04 · 它不会抢走你的工作台</p><h2 id="forms-title">需要一点时，它只出现一点。<br/>需要工作时，才<span>长成完整现场。</span></h2><p>桌面端从一只安静的边缘桌宠开始：双击，写下一句；继续整理时再展开。真正执行仍发生在你正在使用的 Agent 和项目里。</p><ul><li><b>轻</b><span>悬浮入口、极简输入、会话回执</span></li><li><b>深</b><span>同一事项、我的理解、对照与工作现场</span></li><li><b>边界</b><span>当前 Overlay 为手工输入，不会自动读取网页选区</span></li></ul></div><div className="forms-visual"><img className="forms-browser" src="/evidence/zhihu-passage.webp" alt="真实知乎阅读页面"/><img className="forms-overlay forms-overlay-one" src="/evidence/overlay-quiet-crop.webp" alt="Trace 安静悬浮的桌面 Overlay"/><img className="forms-overlay forms-overlay-two" src="/evidence/overlay-input-crop.webp" alt="双击桌宠后出现的 Trace 极简输入"/><img className="forms-overlay forms-overlay-three" src="/evidence/overlay-receipt-crop.webp" alt="接住想法后的 Trace 会话回执"/><div className="forms-caption"><span>真实 Electron Overlay</span><b>安静悬浮 → 极简输入 → 会话回执</b></div></div></section>
  <section className="closing" aria-labelledby="closing-title"><div className="closing-line" aria-hidden="true"/><img src="/real/trace-desktop-pet.png" alt="Trace 桌面端桌宠"/><p>下一次，不必从头解释。</p><h2 id="closing-title">把想过、做过，<br/>和后来发生的事<span>接起来。</span></h2><div className="closing-actions"><a className="primary-cta" href={experience}>体验完整桌面端 <Icon name="right" size={19}/></a><a href="/app">进入我的空间 <Icon name="right" size={17}/></a><a href="/video">观看视频 <Icon name="right" size={17}/></a><a href={repository}><Icon name="code" size={17}/>查看 GitHub</a></div><p className="closing-boundary">完整桌面端提供一套与个人空间隔离的演示数据，六个动作都有可打开的记录；个人空间的数据仅保存在当前浏览器。连接知乎表示授权读取你的知乎资料，不等同于 Trace 云账号或跨设备同步。</p></section></main>
  <footer><a className="brand" href="#main"><span>t.</span>Trace</a><p>让一件仍在变化的事继续发生。</p><a href={repository}>trace_backend <Icon name="right" size={14}/></a></footer></>;
}

const mountPoint = document.querySelector('#app');
if (!mountPoint) throw new Error('Trace 产品介绍缺少 #app 挂载点');
createRoot(mountPoint).render(<IntroApp/>);
