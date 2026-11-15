const SAVE_INDEPENDENT_VIEWS = new Set(['home', 'matters', 'works', 'search', 'all'])

/**
 * A failed mutation must not lock the user out of content which was already
 * saved. Routes which can create or advance a workflow remain guarded until
 * the pending mutation is retried or exported.
 */
export function canNavigateWhileSavePending(route) {
  return SAVE_INDEPENDENT_VIEWS.has(route?.view)
}
