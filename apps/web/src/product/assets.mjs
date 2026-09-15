// Approved originals stay in artifacts. These runtime copies have fixed roles;
// changing a visual requires an explicit new approval, not a fresh generation.
// Public assets stay on the same origin in both Vite dev and the production
// server.  Avoid module-relative `../public` URLs: once bundled, those point
// inside `/assets/` and cause deep-link image flashes.
const asset = name => new URL(`/${name}`, typeof document === 'undefined' ? 'http://127.0.0.1/' : document.baseURI).href;
const shared = Object.freeze({
  birdPerched: asset('home/bird-perched.png'),
  birdTakeoff: asset('home/bird-takeoff.png'),
  // The fixed faces cover product chrome; unknown/user-entered glyphs use the
  // declared system fallbacks. Loading the 28 MB source faces on every route
  // previously starved route chunks on cold production connections.
  serifFont: asset('home/fonts/TraceHomeSerif-fixed.woff2'),
  sansFont: asset('home/fonts/TraceHomeSans-fixed.woff2'),
});
export const ASSETS = Object.freeze({
  home:{...shared,serifFont:asset('home/fonts/TraceHomeSerif-fixed.woff2'),sansFont:asset('home/fonts/TraceHomeSans-fixed.woff2')},
  matters:{...shared,serifFont:asset('matters/fonts/TraceMattersSerif-fixed.woff2'),sansFont:asset('matters/fonts/TraceMattersSans-fixed.woff2')},
  chain:{...shared},
  compare:{...shared},
  worksite:{...shared},
});
