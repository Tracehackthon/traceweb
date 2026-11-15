// Runtime source is pinned under vendor/. This declaration only describes the
// public wrapper used by the lab; it does not claim upstream TypeScript QA.
declare module '@drawnix/drawnix' {
  import type { ComponentType } from 'react';
  export const Drawnix: ComponentType<any>;
}
