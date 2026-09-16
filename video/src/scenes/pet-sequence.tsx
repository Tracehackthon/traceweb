import React from 'react';
import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {CaptureBadge, Grain} from '../components';
import {palette, sans, serif} from '../styles';

const frames = [
  {from: 0, src: 'desktop-pet-quiet.jpg', label: '停在工作区旁边'},
  {from: 34, src: 'desktop-pet-fan.jpg', label: '点一下，打开当前线索'},
  {from: 76, src: 'desktop-pet-typing.jpg', label: '直接写下当时那句话'},
  {from: 112, src: 'desktop-pet-saved.jpg', label: '原话被接住，不自动改成结论'},
];

export const PetSequence: React.FC = () => {
  const frame = useCurrentFrame();
  const index = Math.max(0, frames.findIndex((entry, i) => frame >= entry.from && (i === frames.length - 1 || frame < frames[i + 1].from)));
  const current = frames[index];
  const local = frame - current.from;
  const alpha = interpolate(local, [0, 9], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{background: '#dce8e4', fontFamily: sans}}>
      <Img key={current.src} src={staticFile(`frames/${current.src}`)} style={{width: '100%', height: '100%', objectFit: 'cover', opacity: alpha, transform: `scale(${1.015 + local * 0.00015})`}} />
      <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(90deg,rgba(6,35,30,.80),rgba(6,35,30,.12) 58%,transparent 76%)'}} />
      <div style={{position: 'absolute', left: 94, top: 86}}><CaptureBadge tone="dark">真实 Codex 工作区 · 背景细节已隐去</CaptureBadge></div>
      <div style={{position: 'absolute', left: 100, top: 300, width: 660, color: 'white'}}>
        <p style={{font: `800 20px/1 ${sans}`, letterSpacing: 4, color: '#9ee2cb'}}>TRACE DESKTOP PET</p>
        <h2 style={{font: `600 66px/1.2 ${serif}`, margin: '20px 0 14px'}}>不离开工作，<br/>也能留下一点。</h2>
        <p style={{font: `500 28px/1.6 ${sans}`, color: 'rgba(235,250,244,.86)', margin: 0}}>{current.label}</p>
      </div>
      <div style={{position: 'absolute', left: 100, bottom: 92, display: 'flex', gap: 12}}>{frames.map((entry, i) => <span key={entry.src} style={{height: 8, width: i === index ? 74 : 24, borderRadius: 9, background: i === index ? '#f1bd4d' : 'rgba(255,255,255,.35)'}} />)}</div>
      <Grain />
    </AbsoluteFill>
  );
};
