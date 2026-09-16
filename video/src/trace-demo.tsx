import React from 'react';
import {TransitionSeries, linearTiming} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import {slide} from '@remotion/transitions/slide';
import {FrameStage, SceneLabel} from './components';
import {EndScene} from './scenes/end-scene';
import {PetSequence} from './scenes/pet-sequence';
import {TitleScene} from './scenes/title-scene';

const transition = (kind: 'fade' | 'slide' = 'fade') => (
  <TransitionSeries.Transition
    presentation={kind === 'slide' ? slide({direction: 'from-right'}) : fade()}
    timing={linearTiming({durationInFrames: 18})}
  />
);

export const TraceDemo: React.FC = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence durationInFrames={135}><TitleScene /></TransitionSeries.Sequence>
    {transition('slide')}
    <TransitionSeries.Sequence durationInFrames={150}>
      <FrameStage src="desktop-home.jpg" zoom={[1.02, 1.06]} panX={[0, -12]}>
        <SceneLabel kicker="Trace Desktop" title="桌面端就在真实工作区里打开" detail="这一帧来自当前正在运行的 Trace Electron 桌面窗口。" />
      </FrameStage>
    </TransitionSeries.Sequence>
    {transition()}
    <TransitionSeries.Sequence durationInFrames={150}><PetSequence /></TransitionSeries.Sequence>
    {transition()}
    <TransitionSeries.Sequence durationInFrames={120}>
      <FrameStage src="desktop-pet-panel.jpg" zoom={[1.01, 1.10]} panX={[0, -80]} panY={[0, -26]}>
        <SceneLabel kicker="Live Capabilities" title="一个小窗，接入三类能力" detail="知乎搜索、全网搜索与 Local Codex，在桌宠里直接选择。" />
      </FrameStage>
    </TransitionSeries.Sequence>
    {transition('slide')}
    <TransitionSeries.Sequence durationInFrames={180}>
      <FrameStage src="desktop-pet-zhihu.jpg" zoom={[1.02, 1.15]} panX={[0, -94]} panY={[0, -44]}>
        <SceneLabel kicker="Zhihu · Real API" title="知乎不是标签，而是真实来源" detail="本次查询返回 3 条知乎公开内容摘要；用户仍决定是否保留。" />
      </FrameStage>
    </TransitionSeries.Sequence>
    {transition()}
    <TransitionSeries.Sequence durationInFrames={150}>
      <FrameStage src="trace-resume.jpg" zoom={[1.01, 1.05]}>
        <SceneLabel kicker="Continue" title="原话先回来，理解仍由你写" detail="Trace 不替用户生成结论，也不会把搜索结果直接写进理解。" align="right" />
      </FrameStage>
    </TransitionSeries.Sequence>
    {transition('slide')}
    <TransitionSeries.Sequence durationInFrames={180}>
      <FrameStage src="codex-result.jpg" zoom={[1.01, 1.07]} panX={[0, -18]}>
        <SceneLabel kicker="Local Codex · Returned" title="真实工作结果，回到同一件事" detail="项目与位置自动带入；Codex 返回的事实、解释与未确认项保持分层。" />
      </FrameStage>
    </TransitionSeries.Sequence>
    {transition()}
    <TransitionSeries.Sequence durationInFrames={180}>
      <FrameStage src="codex-result-reader.jpg" zoom={[1.02, 1.08]} panX={[0, -28]}>
        <SceneLabel kicker="Review Before Adopt" title="先读完整结果，再决定要不要改变理解" detail="这段结果来自当前本地 Codex 回流，并非预置演示文本。" />
      </FrameStage>
    </TransitionSeries.Sequence>
    {transition('slide')}
    <TransitionSeries.Sequence durationInFrames={150}><EndScene /></TransitionSeries.Sequence>
  </TransitionSeries>
);
