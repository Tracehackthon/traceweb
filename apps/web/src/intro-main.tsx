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

function BrandMark({ size = 36 }: { size?: number }) {
  return <img className="trace-brand-icon" src="/brand/trace-app-icon-64.png" width={size} height={size} alt="" aria-hidden="true"/>;
}

const formFactors = [
  { key: 'pet', index: '01', name: '悬浮入口', verb: '随时找到', help: '安静待在桌面边缘。只有一点想法时，不必离开眼前的网页或工作。', proof: '当前桌面端 · 桌宠待机', image: '/showcase/desktop-pet-quiet.jpg' },
  { key: 'input', index: '02', name: '极简输入', verb: '先接住', help: '直接说一句、带来一段原文。无需先分类、命名或整理成结论。', proof: '当前桌面端 · 原生 Agent 工作现场', image: '/showcase/desktop-pet-input.jpg' },
  { key: 'bubble', index: '03', name: '小浮窗与气泡', verb: '轻轻接着', help: '承接短讨论、纠正和暂停。收起后留下停点，而不是增加一项待办。', proof: '当前桌面端 · 保存后的停点', image: '/showcase/desktop-pet-saved.jpg' },
  { key: 'matter', index: '04', name: '一件事展开', verb: '深入弄清', help: '需要讨论、找对照或自己写时，再围绕同一件事展开。', proof: '当前 Trace · 一件事继续展开', image: '/showcase/trace-discussion.png' },
  { key: 'desktop', index: '05', name: '完整桌面端', verb: '长期继续', help: '跨时间找回、比较和修订多件仍在变化的事，而不是增加一个聊天窗口。', proof: '当前 Trace · 工作结果回到原问题', image: '/showcase/trace-result-detail.png' },
] as const;

function ContinuityMap() {
  return <div className="continuity-map" aria-label="一件想法从阅读到工作再回来的连续路径">
    <div className="map-context"><span>正在阅读</span><b>知乎 · 关于第二大脑的讨论</b></div>
    <div className="map-line" aria-hidden="true" />
    <div className="map-node node-source"><i/><span>原现场</span><b>为什么停在这里</b></div>
    <div className="map-node node-thinking"><i/><span>思考与讨论</span><b>找到具体断点</b></div>
    <div className="map-node node-understanding"><i/><span>我的理解</span><b>写成自己的判断</b></div>
    <div className="map-node node-work"><i/><span>原生 Agent · 当前工作</span><b>只带这次需要的</b></div>
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
  { key: 'source', tab: '在知乎停住', kicker: '知乎真实参与', title: '不是只留一个链接，而是把知乎观点带回当前问题。', body: '桌宠可以搜索知乎公开内容，保留标题、作者、摘要和原处；你能看见它为什么与这一点有关，再决定是否继续。', image: '/showcase/desktop-zhihu-results.jpg', proof: '当前桌面端 · 知乎搜索结果' },
  { key: 'discuss', tab: '从这里接着', kicker: '回到具体停点', title: '从没想清楚的地方继续，而不是重新概括全文。', body: '讨论会从你停下的位置开始；你可以继续追问，也可以纠正、暂停或换个方向。', image: '/showcase/trace-discussion.png', proof: '当前 Trace · 一件事界面' },
  { key: 'compare', tab: '找个对照', kicker: '知乎与全网', title: '找补充、挑战和限制，而不是再收一个相似答案。', body: '知乎公开内容、全网搜索与知乎直答提供不同观点和经验。Trace 标出相关之处与条件差异，最后由你判断。', image: null, proof: '对照关系示例' },
  { key: 'understanding', tab: '写成我的理解', kicker: '由你确认', title: 'Agent 可以提供解释，但不能替你下结论。', body: '你可以自己写、限定范围、保留矛盾；工作结果回来以后，再决定是否修订原来的理解。', image: '/showcase/trace-result.png', proof: '当前 Trace · 结果与理解' },
] as const;

function ComparisonSample() {
  return <div className="comparison-sample" aria-label="对照材料如何与当前问题发生关系">
    <div className="sample-question"><small>正在想的这一处</small><p>不写附言时，收藏是否一定无法接回来？</p></div>
    <div className="sample-results"><article><span>知乎公开内容</span><b>“具体任务本身，也可能成为重新进入的线索。”</b><p><i>限制</i> 挑战「必须写附言」这一绝对条件</p></article><article><span>全网搜索</span><b>持续项目中的另一种恢复方式</b><p><i>补充</i> 说明项目上下文何时能替代附言</p></article><article><span>知乎直答</span><b>两种说法都还缺少实际结果</b><p><i>未确认</i> 先保留为待确认，不自动改变我的理解</p></article></div>
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
  { key: 'handoff', label: '带入', title: '先确认带到哪里、这次准备怎样用。', body: '项目、任务和内容范围清楚以后，只带当前真正相关的一点。截图展示了桌宠在 Codex 中展开交接面板。', image: '/showcase/desktop-agent-panel.jpg', proof: '桌宠 · 本次交接' },
  { key: 'work', label: '工作', title: '继续在你原来的 Agent 里完成任务。', body: '生成代码、运行命令、检查和交付仍由原生 Agent 完成。Codex 是首个完整适配，也可选择 Codex Harness 与已配置的自定义 Agent。', image: '/showcase/desktop-pet-input.jpg', proof: '本机 Agent · 工作现场' },
  { key: 'return', label: '回来', title: '先看发生了什么，再决定是否改变原来的理解。', body: 'Agent 带回事实、解释和未确认的部分。你确认之后，它才会影响这件事接下来怎样继续。', image: '/showcase/trace-result-detail.png', proof: 'Trace · 完整结果' },
  { key: 'review', label: '复核', title: '确认以后，才改变未来会带回的理解。', body: '保留工作带出的版本、当前理解和候选修改；只改你确认的部分，再从新的版本继续。', image: '/showcase/trace-result.png', proof: 'Trace · 结果复核' },
] as const;

function WorkLoop() {
  const [active, setActive] = useState(0);
  const stage = workStages[active];
  return <div className="work-loop"><div className="work-loop-nav" role="tablist" aria-label="从理解到工作再回来的四个阶段">{workStages.map((item, index) => <button key={item.key} type="button" role="tab" aria-selected={active === index} onClick={() => setActive(index)}><span>{index + 1}</span><b>{item.label}</b></button>)}</div><div className="work-loop-main"><figure className="work-proof"><img data-critical="true" src={stage.image} alt={stage.proof}/><figcaption>{stage.proof}</figcaption></figure><div className="work-copy"><p>0{active + 1} / 04</p><h3>{stage.title}</h3><div>{stage.body}</div><div className="truth-scale"><span><Icon name="check" size={14}/> 已带到工作</span><span className={active >= 1 ? 'on' : ''}><Icon name="check" size={14}/> 已用于工作</span><span className={active >= 2 ? 'on' : ''}><Icon name="check" size={14}/> 结果已回来</span><span className={active >= 3 ? 'on' : ''}><Icon name="check" size={14}/> 已确认修改理解</span></div></div></div></div>;
}

const coreActions = [['留下一点', '此刻先不丢'], ['从这里接着', '回到上次停点'], ['找个对照', '引入不同观点'], ['我的理解', '写成自己的判断'], ['带去用', '进入具体工作'], ['结果回来', '用结果修正判断']];

function IntroApp() {
  useEffect(() => { document.body.className = 'intro-page'; document.title = 'Trace · 让值得思考的想法继续发生'; }, []);
  return <><a className="intro-skip" href="#main">跳到正文</a><header className="intro-header"><a className="intro-brand" href="#main" aria-label="Trace 产品介绍首页"><BrandMark/><b>Trace</b></a><nav aria-label="页面导航"><a href="#shape">如何展开</a><a href="#principles">为什么这样做</a><a href="#thinking">知乎与思考</a><a href="#work">进入工作</a><a href="/video">视频</a></nav><a className="header-action" href="/app/demo">体验完整演示 <Icon name="arrow" size={16}/></a></header>
  <main id="main"><section className="intro-hero" aria-labelledby="opening-title"><div className="hero-copy"><h1 id="opening-title">让值得思考的想法，<em>继续发生。</em></h1><p className="hero-lead">Trace 接住阅读、讨论和工作中还没想完的一点。你可以结合知乎公开内容继续判断，把需要实践的部分带进你正在使用的原生 Agent，再让结果回到原来的问题。</p><div className="hero-actions"><a className="primary-action" href="/app/demo">体验完整演示 <Icon name="arrow"/></a><a href="#shape">先看它怎样展开 <Icon name="down" size={16}/></a></div><div className="hero-claims"><span><Icon name="local" size={17}/><b>本地优先</b>内容先留在你的设备</span><span><Icon name="code" size={17}/><b>继续用原生 Agent</b>不另造一套工作工具</span></div></div><ContinuityMap/></section>
  <section className="shape-section" id="shape" aria-labelledby="shape-title"><div className="section-heading"><p>从轻到深，不打断原现场</p><h2 id="shape-title">不是先打开一个庞大的应用。<br/>需要多少，Trace 才<span>长到多少。</span></h2><div>同一件事在五种形态间继续，不复制内容，也不要求每次都走完整流程。</div></div><FormFactorJourney/></section>
  <section className="principles-section" id="principles" aria-labelledby="principles-title"><div className="principles-intro"><p>我们刻意不做什么</p><h2 id="principles-title">工作不必搬家。<br/>Trace 只补上<span>连续性。</span></h2></div><div className="principle-rows"><article><span>01</span><div><h3>内容优先保存在本机</h3><p>在线演示保存在当前浏览器，桌面端保存在本机。你可以随时导出；目前不提供 Trace 账号和跨设备同步。</p></div></article><article><span>02</span><div><h3>不把工作搬进另一套 Agent</h3><p>Trace 不复制聊天、代码生成和终端。它只把问题的来处、你的理解和工作结果接起来。</p></div></article><article><span>03</span><div><h3>继续在原来的 Agent 里工作</h3><p>理解项目、执行命令、检查与交付仍由你选择的原生 Agent 完成；Trace 只带入这次需要的内容，并接回结果。</p></div></article></div><div className="native-agent-host"><figure><img data-critical="true" src="/showcase/desktop-agent-panel.jpg" alt="Trace 桌宠在本机 Codex 工作现场展开交接面板"/><figcaption><span>当前桌面端</span><b>Trace 留在你原来的 Agent 工作现场</b><p>图中以 Codex 为例：桌宠展开本次内容，工作仍在原来的窗口中完成。</p></figcaption></figure><aside><p>已接入的工作方式</p><ul><li><span>C</span><div><b>Codex 原生</b><small>直接复用已有能力</small></div></li><li><span>H</span><div><b>Codex Harness</b><small>沿用现有项目工作流</small></div></li><li><span>+</span><div><b>自定义 Agent</b><small>选择本机已配置的执行入口</small></div></li></ul><footer>Trace 不替代 Agent，只负责带入这次需要的内容，并接回结果。</footer></aside></div><p className="runtime-truth">在线演示的数据保存在当前浏览器；桌面端通过 Bridge 连接本机能力。截图以 Codex 为例，交接时也可以选择 Harness 或已配置的自定义 Agent。</p></section>
  <section className="thinking-section" id="thinking" aria-labelledby="thinking-title"><div className="section-heading"><p>知乎参与思考，而不是充当素材仓库</p><h2 id="thinking-title">一段触动，如何经过讨论和对照，<br/>变成<span>你自己的理解。</span></h2><div>知乎公开内容带来不同回答、经验和创作者；全网搜索补充边界，Agent 帮你继续追问。来源不会自动变成你的立场。</div></div><ThinkingJourney/></section>
  <section className="work-section" id="work" aria-labelledby="work-title"><div className="section-heading"><p>想清楚以后，不必再手工复制粘贴</p><h2 id="work-title">不把你带回 Trace。<br/>把这段理解带进<span>正在发生的工作。</span></h2><div>把当前理解带进你正在使用的原生 Agent，继续完成原来的工作；结果回来以后，再由你决定是否修改长期理解。</div></div><WorkLoop/></section>
  <section className="one-chain" aria-labelledby="chain-title"><div><p>一条连续链路，不是六个孤立模块</p><h2 id="chain-title">六个动作，都围绕<span>同一件仍在变化的事。</span></h2></div><ol>{coreActions.map(([title, body], index) => <li key={title}><span>0{index + 1}</span><b>{title}</b><p>{body}</p></li>)}</ol><a href="/app/demo">查看六个动作的完整演示 <Icon name="arrow"/></a></section>
  <section className="intro-closing" aria-labelledby="closing-title"><img src="/real/trace-desktop-pet.png" alt="Trace 桌面宠物"/><p>下一次，不必从头解释。</p><h2 id="closing-title">让想过的、做过的，<br/>和后来发生的事<span>继续接起来。</span></h2><div><a className="primary-action" href="/app/demo">体验完整演示 <Icon name="arrow"/></a><a href="/app">进入我的空间</a><a href="/video">观看视频</a><a href={repository}><Icon name="code" size={16}/> GitHub</a></div></section></main>
  <footer className="intro-footer"><a className="intro-brand" href="#main"><BrandMark/><b>Trace</b></a><p>把想过的、做过的，继续接起来。</p><nav><a href="/app/demo">完整演示</a><a href="/video">视频</a><a href={repository}>GitHub</a></nav></footer></>;
}

const mountPoint = document.querySelector('#app');
if (!mountPoint) throw new Error('Trace 产品介绍缺少 #app 挂载点');
createRoot(mountPoint).render(<IntroApp/>);
