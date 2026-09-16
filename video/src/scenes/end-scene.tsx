import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {AppMark, Grain} from '../components';
import {palette, sans, serif} from '../styles';

export const EndScene: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [4, 30], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{background: 'radial-gradient(circle at 74% 25%,#edf8f2 0,#f5f6ef 42%,#e7f0eb 100%)', fontFamily: sans, color: palette.ink}}>
      <div style={{position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(115deg,transparent 0 49.8%,rgba(7,107,85,.09) 50%,transparent 50.2%)'}} />
      <div style={{position: 'absolute', left: 180, top: 178, opacity: enter, transform: `translateY(${(1 - enter) * 34}px)`}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 24}}><AppMark size={76}/><strong style={{fontSize: 54}}>Trace</strong></div>
        <h2 style={{font: `600 92px/1.18 ${serif}`, margin: '54px 0 24px'}}>先接住，<br/><span style={{color: palette.jade}}>然后继续发生。</span></h2>
        <p style={{fontSize: 30, lineHeight: 1.6, color: palette.muted, margin: 0}}>真实桌宠 · 知乎公开内容 · Local Codex 回流</p>
      </div>
      <div style={{position: 'absolute', right: 158, bottom: 142, padding: '30px 38px', borderRadius: 28, background: 'rgba(255,255,255,.72)', border: `1px solid ${palette.line}`, boxShadow: '0 22px 70px rgba(4,63,51,.12)', opacity: enter}}>
        <small style={{display: 'block', color: palette.muted, fontSize: 20, marginBottom: 8}}>现在体验</small>
        <strong style={{fontSize: 36, color: palette.jade}}>trace.neutrom.store/video</strong>
      </div>
      <Grain />
    </AbsoluteFill>
  );
};
