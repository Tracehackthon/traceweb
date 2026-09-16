import React from 'react';
import {Composition} from 'remotion';
import {TraceDemo} from './trace-demo';

export const VIDEO_FPS = 30;
export const VIDEO_WIDTH = 1920;
export const VIDEO_HEIGHT = 1080;
export const VIDEO_DURATION = 1251;

export const VideoRoot: React.FC = () => (
  <Composition
    id="TraceDemo"
    component={TraceDemo}
    durationInFrames={VIDEO_DURATION}
    fps={VIDEO_FPS}
    width={VIDEO_WIDTH}
    height={VIDEO_HEIGHT}
  />
);
