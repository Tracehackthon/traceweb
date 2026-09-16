import React from 'react';
import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {AppMark, CaptureBadge, Grain} from '../components';
import {palette, sans, serif} from '../styles';

export const TitleScene: React.FC = () => {
  const frame = useCurrentFrame();
  const reveal = interpolate(frame, [8, 32], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const image = interpolate(frame, [0, 134], [1.03, 1.09], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{background: palette.ink, fontFamily: sans, overflow: 'hidden'}}>
      <Img src={staticFile('frames/desktop-home.jpg')} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${image})`, opacity: 0.34, filter: 'blur(2px) saturate(.85)'}} />
      <AbsoluteFill style={{background: 'linear-gradient(90deg,rgba(2,30,25,.96) 0%,rgba(2,30,25,.84) 48%,rgba(2,30,25,.30) 100%)'}} />
      <div style={{position: 'absolute', left: 116, top: 102, display: 'flex', alignItems: 'center', gap: 22, opacity: reveal}}><AppMark/><strong style={{fontSize: 44, color: 'white'}}>Trace</strong></div>
      <div style={{position: 'absolute', left: 116, top: 320, width: 1040, opacity: reveal, transform: `translateY(${(1 - reveal) * 36}px)`}}>
        <CaptureBadge tone="dark">真实桌面端 · 实际运行画面</CaptureBadge>
        <h1 style={{font: `600 88px/1.15 ${serif}`, color: 'white', margin: '30px 0 22px', letterSpacing: -2}}>把工作现场接住，<br/><span style={{color: '#9ee2cb'}}>再让结果回来。</span></h1>
        <p style={{font: `400 31px/1.65 ${sans}`, color: 'rgba(234,250,243,.82)', margin: 0, maxWidth: 900}}>桌宠记录当下，知乎补充来源，Local Codex 完成工作。原话、判断与结果始终分开。</p>
      </div>
      <Grain />
    </AbsoluteFill>
  );
};
