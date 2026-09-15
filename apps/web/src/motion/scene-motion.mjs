// Shared Trace scene motion adapter.
//
// Anime.js remains the only scheduling engine in the product.  This module
// deliberately owns decoration only: the content/form tree is a sibling DOM
// layer and is never scaled with the irregular surface.  All coordinates
// passed to draw() are in the scene's design viewBox, so a browser resize does
// not change the meaning of a node, line, or bird anchor.
import { animate, svg, createScope } from '../vendor/anime.esm.js';

export const motionTokens = Object.freeze({
  feedback: 120,
  enter: 420,
  exit: 280,
  ease: 'out(4)',
});

function abortAnimations(jobs) {
  for (const job of jobs) {
    try { job?.cancel?.(); } catch { /* visual cleanup must not block unmount */ }
  }
  jobs.length = 0;
}

/**
 * Morph one irregular SVG shape while moving its related scene geometry.
 *
 * `initialPath` and `expandedPath` are local path coordinates.  The `draw`
 * callback must apply the supplied geometry to the local shape and to every
 * related path/node/bird in one batch.  The callback is visual-only; it must
 * not save state or trigger navigation.
 */
export function createSceneMotion({
  root,
  shape,
  targetPath,
  initialPath,
  expandedPath,
  initial,
  expanded,
  draw,
  onStart,
  onSettled,
  reducedMotion,
}) {
  if (!root || !shape || !targetPath || typeof draw !== 'function') {
    throw new TypeError('createSceneMotion requires root, shape, targetPath, and draw');
  }
  const media = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
  const geometry = { ...initial };
  let scope = createScope({ root });
  let desired = false;
  let revision = 0;
  let disposed = false;
  const jobs = [];

  const reduce = () => Boolean(reducedMotion?.() ?? media?.matches);
  const renewScope = () => {
    // Scope.revert() releases only animations registered by this controller.
    // Preserve the currently painted d/geometry so a reversal starts exactly
    // where the user interrupted it instead of snapping to an endpoint.
    const currentD = shape.getAttribute('d') || initialPath;
    const currentGeometry = { ...geometry };
    scope.revert();
    shape.setAttribute('d', currentD);
    Object.assign(geometry, currentGeometry);
    scope = createScope({ root });
  };
  const stop = () => abortAnimations(jobs);
  const paint = () => draw({ ...geometry }, desired);

  function setExpanded(open, { immediate = false } = {}) {
    if (disposed) return;
    desired = Boolean(open);
    const token = ++revision;
    stop();
    renewScope();
    const goal = desired ? expanded : initial;
    const path = desired ? expandedPath : initialPath;
    root.dataset.motionState = desired ? 'opening' : 'closing';
    onStart?.(desired);

    if (reduce() || immediate) {
      Object.assign(geometry, goal);
      shape.setAttribute('d', path);
      paint();
      root.dataset.motionState = desired ? 'open' : 'closed';
      onSettled?.(desired);
      return;
    }

    const duration = desired ? motionTokens.enter : motionTokens.exit;
    targetPath.setAttribute('d', path);
    scope.add(() => {
      // Both tweens start from the current d/geometry.  A later call cancels
      // this scope and paints from the interrupted frame before continuing.
      jobs.push(animate(shape, {
        d: svg.morphTo(targetPath, .05),
        duration,
        ease: motionTokens.ease,
      }));
      jobs.push(animate(geometry, {
        ...goal,
        duration,
        ease: motionTokens.ease,
        onUpdate: paint,
        onComplete: () => {
          if (disposed || token !== revision) return;
          Object.assign(geometry, goal);
          shape.setAttribute('d', path);
          paint();
          jobs.length = 0;
          root.dataset.motionState = desired ? 'open' : 'closed';
          onSettled?.(desired);
        },
      }));
    });
  }

  const preferenceChanged = () => {
    // If the user enables reduced motion while a scene is moving, settle in
    // place immediately.  Turning it off does not replay an old transition.
    if (media?.matches) setExpanded(desired, { immediate: true });
  };
  media?.addEventListener?.('change', preferenceChanged);
  shape.setAttribute('d', initialPath);
  paint();
  root.dataset.motionState = 'closed';

  return {
    setExpanded,
    getState: () => ({
      desired,
      revision,
      disposed,
      geometry: { ...geometry },
      activeJobs: jobs.length,
    }),
    destroy() {
      if (disposed) return;
      disposed = true;
      ++revision;
      stop();
      media?.removeEventListener?.('change', preferenceChanged);
      scope.revert();
    },
  };
}

