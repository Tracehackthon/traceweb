import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

const repository = 'https://github.com/Tracehackthon/trace_backend';
const zhihuSource = 'https://www.zhihu.com/question/1980227498164913662/answer/1981838969739178783';

type IconName = 'arrow' | 'down' | 'external' | 'code' | 'local' | 'check';
const paths: Record<IconName, React.ReactNode> = {
  arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
  down: <><path d="M12 5v14"/><path d="m6 13 6 6 6-6"/></>,
  external: <><path d="M14 4h6v6"/><path d="m10 14 10-10"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></>,
  code: <><path d="m9 18-6-6 6-6"/><path d="m15 6 6 6-6 6"/></>,
  local: <><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></>,
  check: <path d="m5 12 4 4 10-10"/>,
};

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const formFactors = [
  { key: 'pet', index: '01', name: '悬浮入口', verb: '随时找到', help: '安静待在桌面边缘。只有一点想法时，不必离开眼前的网页或工作。', proof: '真实 Electron 桌宠', image: '/evidence/overlay-quiet-crop.webp' },
  { key: 'input', index: '02', name: '极简输入', verb: '先接住', help: '直接说一句、带来一段原文。无需先分类、命名或把触动整理成结论。', proof: '真实 Electron 极简输入', image: '/evidence/overlay-input-crop.webp' },
  { key: 'bubble', index: '03', name: '小浮窗与气泡', verb: '轻轻接着', help: '承接短讨论、纠正和暂停。收起后留下真实停点，而不是制造一个待办。', proof: '真实 Electron 保存回执', image: '/evidence/overlay-receipt-crop.webp' },
  { key: 'matter', index: '04', name: '一件事展开', verb: '深入弄清', help: '需要讨论、找对照或自己写时，围绕刚才同一件事逐渐展开。', proof: '真实 Trace 一件事界面', image: '/evidence/trace-matter.webp' },
  { key: 'desktop', index: '05', name: '完整桌面端', verb: '长期继续', help: '跨时间找回、比较和修订多件仍在变化的事；它不是最大号聊天窗口。', proof: '真实 Trace 我的理解界面', image: '/evidence/trace-understanding-v1.webp' },
] as const;

function ContinuityMap() {
  return <div className="continuity-map" aria-label="一件想法从阅读到工作再回来的连续路径">
    <div className="map-context"><span>正在阅读</span><b>知乎 · 关于第二大脑的讨论</b></div>
    <div className="map-line" aria-hidden="true" />
    <div className="map-node node-source"><i/><span>原现场</span><b>为什么停在这里</b></div>
    <div className="map-node node-thinking"><i/><span>思考与讨论</span><b>找到具体断点</b></div>
    <div className="map-node node-understanding"><i/><span>我的理解</span><b>写成自己的判断</b></div>
    <div className="map-node node-work"><i/><span>Codex · 当前工作</span><b>只带这次需要的</b></div>
    <div className="map-node node-return"><i/><span>结果回来</span><b>确认后再改变理解</b></div>
    <img src="/real/trace-desktop-pet.png" alt="Trace 桌宠沿着同一件事的轨迹移动" />
    <p>同一件事，没有被拆成收藏、聊天和工作总结。</p>
  </div>;
}

function FormFactorJourney() {
  const [active, setActive] = useState(0);
  const stage = formFactors[active];
  return <div className="format-journey">
    <figure className="format-preview" data-stage={stage.key}>
      <div className="preview-top"><span>TRACE / DESKTOP</span><b>{stage.proof}</b></div>
      <div className="preview-surface"><span className="preview-work">你原来的工作仍在这里</span><img data-critical="true" src={stage.image} alt={stage.proof}/></div>
      <figcaption><span>{stage.index}</span><p><b>{stage.name}</b>{stage.help}</p></figcaption>
    </figure>
    <ol className="format-steps">{formFactors.map((item, index) => <li key={item.key}><button className="format-step" type="button" aria-pressed={active === index} onClick={() => setActive(index)}><span>{item.index}</span><div><small>{item.verb}</small><b>{item.name}</b><p>{item.help}</p></div><i aria-hidden="true">↗</i></button></li>)}</ol>
  </div>;
}

const thinkingStages = [
  { key: 'source', tab: '在知乎停住', kicker: '原现场不丢', title: '先保留原文，也保留你为什么停下来。', body: 'Trace 不只收藏一个链接。原文、作者、当时的一句话和仍没想清的地方保持各自身份。', image: '/evidence/zhihu-passage.webp', proof: '真实知乎阅读现场' },
  { key: 'discuss', tab: '从这里接着', kicker: '讨论有停点', title: 'Agent 从你的具体断点开始，而不是重新概括全文。', body: '暂时提不出新问题时，可以用已有讨论找到还没被具体情形检验的位置；也可以纠正、暂停或换方向。', image: '/evidence/trace-matter.webp', proof: '真实 Trace 一件事界面' },
  { key: 'compare', tab: '找真实对照', kicker: '知乎与全网', title: '找补充、挑战和限制，而不是再给一个相似答案。', body: '知乎公开内容、全网搜索与知乎直答提供不同人的真实经验。Trace 说明它与哪一处相关、条件哪里不同，最后仍由你决定。', image: null, proof: '完整演示中的对照数据' },
  { key: 'understanding', tab: '写成我的理解', kicker: '用户最后一票', title: 'Agent 的解释可以帮忙，但不会自动变成你的结论。', body: '你可以自己写、限定范围、保留矛盾；每次修改都有来处，旧版本不会被一段新摘要静默覆盖。', image: '/evidence/trace-understanding-v1.webp', proof: '真实 Trace 我的理解界面' },
] as const;

function ComparisonSample() {
  return <div className="comparison-sample" aria-label="对照材料如何与当前问题发生关系">
    <div className="sample-question"><small>正在想的这一处</small><p>不写附言时，收藏是否一定无法接回来？</p></div>
    <div className="sample-results"><article><span>知乎公开内容</span><b>“具体任务本身，也可能成为重新进入的线索。”</b><p><i>限制</i> 挑战「必须写附言」这一绝对条件</p></article><article><span>全网搜索</span><b>持续项目中的另一种恢复方式</b><p><i>补充</i> 说明项目上下文何时能替代附言</p></article><article><span>知乎直答</span><b>两种说法仍缺少真实使用结果</b><p><i>未确认</i> 不把候选解释冒充用户结论</p></article></div>
  </div>;
}

function ThinkingJourney() {
  const [active, setActive] = useState(0);
  const stage = thinkingStages[active];
  return <div className="thinking-journey">
    <div className="thinking-tabs" role="tablist" aria-label="思考与讨论的四个阶段">{thinkingStages.map((item, index) => <button key={item.key} type="button" role="tab" aria-selected={active === index} aria-controls="thinking-panel" onClick={() => setActive(index)}><span>0{index + 1}</span>{item.tab}</button>)}</div>
    <div className="thinking-panel" id="thinking-panel" role="tabpanel" data-stage={stage.key}><div className="thinking-copy"><p>{stage.kicker}</p><h3>{stage.title}</h3><div>{stage.body}</div>{stage.key === 'source' && <a href={zhihuSource} target="_blank" rel="noreferrer">查看知乎原文 <Icon name="external" size={15}/></a>}<small>{stage.proof}</small></div><div className="thinking-proof">{stage.image ? <img data-critical="true" src={stage.image} alt={stage.proof}/> : <ComparisonSample/>}</div></div>
  </div>;
}

const workStages = [
  { key: 'handoff', label: '带入', title: '先确认带到哪里、这次准备怎样用。', body: '宿主、项目、任务和内容范围清楚以后，只带当前真正相关的一点。送达不等于已经采用。', image: '/evidence/trace-handoff.webp' },
  { key: 'work', label: '工作', title: 'Codex 继续是工作主场。', body: '生成代码、运行命令、检查和交付仍由 Codex 完成。Trace 贴在旁边，显示过去带入了什么、工作中又出现了什么。', image: '/evidence/trace-worksite.webp' },
  { key: 'return', label: '回来', title: '先分清事实、解释和仍未确认。', body: '实现完成不等于真实使用有效。结果先回到原来的事情，等待用户辨认它支持、限制还是挑战了什么。', image: '/evidence/trace-returned.webp' },
  { key: 'review', label: '复核', title: '确认以后，才改变未来会带回的理解。', body: '保留工作带出的 v1、当前的 v2 和候选修改；只改用户确认的部分，再从新的版本继续。', image: '/evidence/trace-review.webp' },
] as const;

function WorkLoop() {
  const [active, setActive] = useState(0);
  const stage = workStages[active];
  return <div className="work-loop"><div className="work-loop-nav" role="tablist" aria-label="从理解到工作再回来的四个阶段">{workStages.map((item, index) => <button key={item.key} type="button" role="tab" aria-selected={active === index} onClick={() => setActive(index)}><span>{index + 1}</span><b>{item.label}</b></button>)}</div><div className="work-loop-main"><div className="work-proof"><img data-critical="true" src={stage.image} alt={`真实 Trace ${stage.label}界面`}/><span>真实 Trace Web 界面</span></div><div className="work-copy"><p>0{active + 1} / 04</p><h3>{stage.title}</h3><div>{stage.body}</div><div className="truth-scale"><span><Icon name="check" size={14}/> 已带到工作</span><span className={active >= 1 ? 'on' : ''}><Icon name="check" size={14}/> 参与具体做法</span><span className={active >= 2 ? 'on' : ''}><Icon name="check" size={14}/> 结果已回来</span><span className={active >= 3 ? 'on' : ''}><Icon name="check" size={14}/> 理解已确认修改</span></div></div></div></div>;
}

const coreActions = [['留下一点', '此刻先不丢'], ['从这里接着', '恢复真实停点'], ['找个对照', '让不同经验进来'], ['我的理解', '写成自己的判断'], ['带去用', '进入具体工作'], ['结果回来', '让实践继续改变它']];

function IntroApp() {
  useEffect(() => { document.body.className = 'intro-page'; document.title = 'Trace · 让值得思考的想法继续发生'; }, []);
  return <><a className="intro-skip" href="#main">跳到正文</a><header className="intro-header"><a className="intro-brand" href="#main" aria-label="Trace 产品介绍首页"><span>t.</span><b>Trace</b></a><nav aria-label="页面导航"><a href="#shape">如何展开</a><a href="#principles">产品选择</a><a href="#thinking">知乎与思考</a><a href="#work">进入工作</a><a href="/video">视频</a></nav><a className="header-action" href="/app/demo">体验完整演示 <Icon name="arrow" size={16}/></a></header>
  <main id="main"><section className="intro-hero" aria-labelledby="opening-title"><div className="hero-copy"><p className="intro-eyebrow"><span/>LOCAL-FIRST CONTINUOUS THINKING</p><h1 id="opening-title">让值得思考的想法，<em>继续发生。</em></h1><p className="hero-lead">Trace 是一个以桌面本地为主的连续思考工作空间。它从原现场接住一点，在知乎与 Agent 的帮助下逐渐形成你的理解，再把真正需要的部分带进 Codex，让工作结果回到原来的问题。</p><div className="hero-actions"><a className="primary-action" href="/app/demo">体验完整桌面端 <Icon name="arrow"/></a><a href="#shape">先看它怎样展开 <Icon name="down" size={16}/></a></div><div className="hero-claims"><span><Icon name="local" size={17}/><b>本地优先</b>内容先留在你的设备</span><span><Icon name="code" size={17}/><b>Codex 优先</b>不重复造一个 Agent</span></div></div><ContinuityMap/></section>
  <section className="shape-section" id="shape" aria-labelledby="shape-title"><div className="section-heading"><p>从轻到深，不打断原现场</p><h2 id="shape-title">不是先打开一个庞大的应用。<br/>需要多少，Trace 才<span>长到多少。</span></h2><div>同一件事在五种形态间继续，不复制内容，也不要求每次都走完整流程。</div></div><FormFactorJourney/></section>
  <section className="principles-section" id="principles" aria-labelledby="principles-title"><div className="principles-intro"><p>我们刻意不做什么</p><h2 id="principles-title">工作不必搬家。<br/>Trace 只补上<span>连续性。</span></h2></div><div className="principle-rows"><article><span>01</span><div><h3>Local-first，不先建立云端依赖</h3><p>个人内容、停点和理解优先保存在本机。你能看见保存位置，也能导出；Trace 账号和跨设备同步不是当前前提。</p></div></article><article><span>02</span><div><h3>不做第二套 Agent 工具</h3><p>Trace 不复制模型聊天、代码生成和终端。它负责把来处、你的理解与真实结果接起来。</p></div></article><article><span>03</span><div><h3>Codex 是首要工作宿主</h3><p>充分使用 Codex 原生的理解、执行、检查与交付能力；Trace 只把本次相关内容贴在工作旁边。</p></div></article></div><div className="codex-host"><div className="codex-window"><div className="codex-bar"><span/><span/><span/><b>Codex · traceweb</b></div><div className="codex-task"><small>当前任务</small><strong>重新设计产品交互介绍</strong><p>正在读取项目、修改界面、运行测试……</p><div className="code-lines"><i/><i/><i/><i/></div></div></div><aside><p>TRACE · 本次带回</p><article><b>不要让用户离开原来的工作空间</b><span>用于：保持 Codex 为工作主场</span></article><article><b>从极简入口逐渐展开</b><span>用于：介绍页的交互主线</span></article><footer>只带这次相关的 2 条</footer></aside><div className="return-thread" aria-hidden="true"><span>过去的理解</span><i/><span>当前工作</span><i/><span>实际结果</span><i/><span>回到原问题</span></div></div><p className="runtime-truth">桌面端是产品主形态；当前在线演示的数据保存在浏览器本地。Codex 的真实领取与结果回流由 trace_backend 的原生接入承担。</p></section>
  <section className="thinking-section" id="thinking" aria-labelledby="thinking-title"><div className="section-heading"><p>知乎参与思考，而不是充当素材仓库</p><h2 id="thinking-title">一段触动，如何经过讨论和真实对照，<br/>变成<span>你自己的理解。</span></h2><div>知乎帮助 Trace 找到多元回答、真实经验和相关创作者；全网搜索补充边界，Agent 帮你定位具体断点。来源不会自动变成你的立场。</div></div><ThinkingJourney/></section>
  <section className="work-section" id="work" aria-labelledby="work-title"><div className="section-heading"><p>想清楚以后，不必再手工搬运</p><h2 id="work-title">不把你带回 Trace。<br/>把这段理解带进<span>正在发生的工作。</span></h2><div>过去形成的理解进入 Codex，工作仍在原生 Agent 中完成；事实与解释回来以后，再由你决定是否修改长期理解。</div></div><WorkLoop/></section>
  <section className="one-chain" aria-labelledby="chain-title"><div><p>一条连续链路，不是六个孤立模块</p><h2 id="chain-title">六个动作，都围绕<span>同一件仍在变化的事。</span></h2></div><ol>{coreActions.map(([title, body], index) => <li key={title}><span>0{index + 1}</span><b>{title}</b><p>{body}</p></li>)}</ol><a href="/app/demo">逐个打开六个动作的数据 <Icon name="arrow"/></a></section>
  <section className="intro-closing" aria-labelledby="closing-title"><img src="/real/trace-desktop-pet.png" alt="Trace 桌面宠物"/><p>下一次，不必从头解释。</p><h2 id="closing-title">让想过的、做过的，<br/>和后来发生的事<span>继续接起来。</span></h2><div><a className="primary-action" href="/app/demo">体验完整演示 <Icon name="arrow"/></a><a href="/app">进入我的空间</a><a href="/video">观看视频</a><a href={repository}><Icon name="code" size={16}/> GitHub</a></div></section></main>
  <footer className="intro-footer"><a className="intro-brand" href="#main"><span>t.</span><b>Trace</b></a><p>Local-first continuous thinking workspace.</p><nav><a href="/app/demo">完整演示</a><a href="/video">视频</a><a href={repository}>trace_backend</a></nav></footer></>;
}

const mountPoint = document.querySelector('#app');
if (!mountPoint) throw new Error('Trace 产品介绍缺少 #app 挂载点');
createRoot(mountPoint).render(<IntroApp/>);
