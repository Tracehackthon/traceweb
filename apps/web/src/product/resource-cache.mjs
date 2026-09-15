/**
 * Small, route-aware resource boundary shared by the React shell and the
 * incumbent scene adapters.  It intentionally has no React dependency: the
 * cache can be used by an adapter mounted outside React as well.
 */
const imageCache = new Map();
const fontCache = new Map();
const stats = {
  imageHits: 0,
  imageMisses: 0,
  imageFailures: 0,
  fontHits: 0,
  fontMisses: 0,
};

const browser = () => typeof window !== 'undefined' && typeof document !== 'undefined';

function imageKey(url) {
  return String(url || '');
}

/** Preload and decode a visual asset before a route is mounted. */
export function preloadImage(url, { timeoutMs = 7000 } = {}) {
  const key = imageKey(url);
  if (!key || !browser() || typeof Image === 'undefined') return Promise.resolve(null);
  const existing = imageCache.get(key);
  if (existing) {
    stats.imageHits += 1;
    return existing;
  }
  stats.imageMisses += 1;
  const promise = new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    let settled = false;
    const timer = window.setTimeout(() => finish(new Error(`资源加载超时：${key}`)), timeoutMs);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      if (error) {
        stats.imageFailures += 1;
        imageCache.delete(key);
        reject(error);
      } else {
        resolve(image);
      }
    };
    image.onload = () => {
      // decode() is a stronger readiness gate than onload: it prevents the
      // old scene being replaced while the incoming bitmap is still flashing.
      if (typeof image.decode === 'function') {
        image.decode().then(() => finish()).catch((error) => {
          // Some browsers reject decode() after a successful onload for a
          // cached image.  A non-zero naturalWidth is still a valid fallback.
          if (image.naturalWidth > 0) finish();
          else finish(error instanceof Error ? error : new Error(`资源解码失败：${key}`));
        });
      } else finish();
    };
    image.onerror = () => finish(new Error(`资源加载失败：${key}`));
    image.src = key;
    if (image.complete && image.naturalWidth > 0) image.onload();
  });
  imageCache.set(key, promise);
  return promise;
}

export function preloadImages(urls, options) {
  return Promise.all([...new Set((urls || []).filter(Boolean).map(String))].map((url) => preloadImage(url, options)));
}

/**
 * Register one named face globally.  Screen instances do not own/delete the
 * face; this keeps warm revisits stable and prevents per-instance FontFace
 * growth during rapid A-B-A navigation.
 */
export function registerFont({ family, url, weight = '400', style = 'normal', display = 'swap' } = {}) {
  const name = String(family || '').trim();
  const source = String(url || '').trim();
  if (!name || !source || !browser() || typeof FontFace === 'undefined' || !document.fonts) return Promise.resolve(null);
  const key = `${name}|${source}|${weight}|${style}`;
  const existing = fontCache.get(key);
  if (existing) {
    stats.fontHits += 1;
    return existing.promise;
  }
  // A CSS-loaded face with the same family is already the canonical one.
  const installed = [...document.fonts].find((font) => font.family.replace(/^['"]|['"]$/g, '') === name);
  if (installed) {
    const promise = Promise.resolve(installed);
    fontCache.set(key, { promise, face: installed });
    stats.fontHits += 1;
    return promise;
  }
  stats.fontMisses += 1;
  const face = new FontFace(name, `url(${JSON.stringify(source)})`, { weight, style, display });
  const promise = face.load().then((loaded) => {
    if (![...document.fonts].includes(loaded)) document.fonts.add(loaded);
    return loaded;
  }).catch((error) => {
    fontCache.delete(key);
    throw error instanceof Error ? error : new Error(`字体加载失败：${name}`);
  });
  fontCache.set(key, { promise, face });
  return promise;
}

export function clearResourceCache({ images = [], fonts = [] } = {}) {
  for (const url of images) imageCache.delete(imageKey(url));
  for (const family of fonts) {
    for (const key of fontCache.keys()) if (key.startsWith(`${String(family)}|`)) fontCache.delete(key);
  }
}

export function getResourceStats() {
  return {
    ...stats,
    cachedImages: imageCache.size,
    cachedFonts: fontCache.size,
  };
}

