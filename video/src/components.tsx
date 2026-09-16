import React from 'react';
import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {fill, palette, sans} from './styles';

export const Grain: React.FC = () => (
  <div style={{...fill, pointerEvents: 'none', opacity: 0.16, backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(255,255,255,.8) 0 1px, transparent 1.5px)', backgroundSize: '8px 8px', mixBlendMode: 'soft-light'}} />
);

export const AppMark: React.FC<{size?: number; inverse?: boolean}> = ({size = 62, inverse = false}) => (
  <div style={{width: size, height: size, borderRadius: size * 0.23, display: 'grid', placeItems: 'center', background: inverse ? 'rgba(255,255,255,.96)' : 'linear-gradient(145deg,#f8fbf7,#e4f0e9)', boxShadow: 'inset 0 1px 1px rgba(255,255,255,.75),0 18px 45px rgba(7,107,85,.22)', overflow: 'hidden'}}>
    <Img src={staticFile('brand/trace-app-icon.png')} style={{width: size * 0.79, height: size * 0.79, objectFit: 'contain'}} />
  </div>
);

export const CaptureBadge: React.FC<{children: React.ReactNode; tone?: 'light' | 'dark'}> = ({children, tone = 'light'}) => (
  <div style={{display: 'inline-flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderRadius: 999, background: tone === 'light' ? 'rgba(246,248,243,.88)' : 'rgba(5,40,33,.82)', border: `1px solid ${tone === 'light' ? palette.line : 'rgba(255,255,255,.18)'}`, color: tone === 'light' ? palette.jade : '#e9fff7', backdropFilter: 'blur(18px)', boxShadow: '0 12px 40px rgba(2,46,37,.1)', font: `600 24px/1 ${sans}`, letterSpacing: 0.4}}>
    <span style={{width: 9, height: 9, borderRadius: '50%', background: tone === 'light' ? palette.amber : '#8fe0c5', boxShadow: `0 0 0 6px ${tone === 'light' ? 'rgba(239,180,59,.14)' : 'rgba(143,224,197,.12)'}`}} />
    {children}
  </div>
);

export const FrameStage: React.FC<{
  src: string;
  zoom?: [number, number];
  panX?: [number, number];
  panY?: [number, number];
  dim?: number;
  children?: React.ReactNode;
}> = ({src, zoom = [1, 1.035], panX = [0, 0], panY = [0, 0], dim = 0, children}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const scale = zoom[0] + (zoom[1] - zoom[0]) * progress;
  const x = panX[0] + (panX[1] - panX[0]) * progress;
  const y = panY[0] + (panY[1] - panY[0]) * progress;
  const enter = interpolate(frame, [0, 14], [0, 1], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{background: '#dfeae5', fontFamily: sans}}>
      <div style={{position: 'absolute', inset: 42, borderRadius: 34, overflow: 'hidden', background: '#f7faf7', boxShadow: '0 30px 90px rgba(3,50,40,.22)', border: '1px solid rgba(255,255,255,.88)', opacity: enter, transform: `translateY(${(1 - enter) * 20}px)`}}>
        <Img src={staticFile(`frames/${src}`)} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `translate(${x}px,${y}px) scale(${scale})`}} />
        {dim > 0 && <div style={{...fill, background: `rgba(4,25,21,${dim})`}} />}
        <div style={{...fill, boxShadow: 'inset 0 0 130px rgba(1,31,25,.08)', pointerEvents: 'none'}} />
      </div>
      {children}
      <Grain />
    </AbsoluteFill>
  );
};

export const SceneLabel: React.FC<{kicker: string; title: string; detail?: string; align?: 'left' | 'right'}> = ({kicker, title, detail, align = 'left'}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [8, 24], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <div style={{position: 'absolute', top: 82, [align]: 88, width: 680, padding: '26px 30px 28px', borderRadius: 28, background: 'rgba(248,250,246,.88)', border: `1px solid ${palette.line}`, backdropFilter: 'blur(22px)', boxShadow: '0 20px 60px rgba(3,50,40,.13)', opacity, transform: `translateY(${(1 - opacity) * 18}px)`, fontFamily: sans}}>
      <div style={{color: palette.jade, fontSize: 20, fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase'}}>{kicker}</div>
      <div style={{color: palette.ink, fontSize: 43, fontWeight: 700, lineHeight: 1.28, marginTop: 12}}>{title}</div>
      {detail && <div style={{color: palette.muted, fontSize: 24, lineHeight: 1.55, marginTop: 12}}>{detail}</div>}
    </div>
  );
};
