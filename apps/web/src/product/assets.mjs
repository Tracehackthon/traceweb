// Approved originals stay in artifacts. These runtime copies have fixed roles;
// changing a visual requires an explicit new approval, not a fresh generation.
// Public assets stay on the same origin in both Vite dev and the production
// server.  Avoid module-relative `../public` URLs: once bundled, those point
// inside `/assets/` and cause deep-link image flashes.
const asset = name => new URL(`/${name}`, typeof document === 'undefined' ? 'http://127.0.0.1/' : document.baseURI).href;
const shared = Object.freeze({birdPerched:asset('home/bird-perched.png'),birdTakeoff:asset('home/bird-takeoff.png'),serifFont:asset('product/fonts/TraceSerif.woff2'),sansFont:asset('product/fonts/TraceSans.ttf'),fullSerifFont:asset('product/fonts/TraceSerif.woff2'),fullSansFont:asset('product/fonts/TraceSans.ttf')});
export const ASSETS = Object.freeze({
  home:{...shared,serifFont:asset('home/fonts/TraceHomeSerif-fixed.woff2'),sansFont:asset('home/fonts/TraceHomeSans-fixed.woff2'),background:asset('home/environment.png')},
  matters:{...shared,serifFont:asset('matters/fonts/TraceMattersSerif-fixed.woff2'),sansFont:asset('matters/fonts/TraceMattersSans-fixed.woff2'),background:asset('matters/environment.png')},
  chain:{...shared,background:asset('product/chain-environment.png'),overviewBackground:asset('product/chain-overview-environment.png')},
  compare:{...shared,background:asset('product/compare-environment.png')},
  worksite:{...shared,background:asset('product/worksite-environment.png')},
});
