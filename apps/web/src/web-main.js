// Keep the public introduction, full product and reserved video route in one
// deployment while loading only the surface a visitor actually requested.
import introStylesheet from './intro.css?url';
import videoStylesheet from './video.css?url';

const path = window.location.pathname.replace(/\/+$/, '') || '/';
const legacyProductLink = path === '/' && new URLSearchParams(window.location.search).has('view');

function loadStylesheet(href) {
  const existing = document.querySelector(`link[rel="stylesheet"][href="${href}"]`);
  if (existing) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = resolve;
    link.onerror = () => reject(new Error(`Unable to load route stylesheet: ${href}`));
    document.head.append(link);
  });
}

if (path === '/video') {
  void loadStylesheet(videoStylesheet).then(() => import('./video-main.tsx'));
} else if (path === '/' && !legacyProductLink) {
  void loadStylesheet(introStylesheet).then(() => import('./intro-main.tsx'));
} else {
  void import('./react-main.tsx');
}
