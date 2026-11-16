const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function center(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Build a quiet, non-redundant graph that keeps every visible node connected. */
export function buildProximityTree(rects = []) {
  if (rects.length < 2) return [];
  const connected = new Set([0]);
  const edges = [];
  while (connected.size < rects.length) {
    let best = null;
    for (const from of connected) {
      const a = center(rects[from]);
      for (let to = 0; to < rects.length; to += 1) {
        if (connected.has(to)) continue;
        const b = center(rects[to]);
        const distance = Math.hypot(b.x - a.x, b.y - a.y);
        if (!best || distance < best.distance) best = { from, to, distance };
      }
    }
    if (!best) break;
    edges.push([best.from, best.to]);
    connected.add(best.to);
  }
  return edges;
}

function edgeAnchor(rect, target) {
  const origin = center(rect);
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  if (!dx && !dy) return origin;
  const inset = 7;
  const halfWidth = Math.max(1, rect.width / 2 - inset);
  const halfHeight = Math.max(1, rect.height / 2 - inset);
  const scale = Math.min(
    Math.abs(dx) > .001 ? halfWidth / Math.abs(dx) : Infinity,
    Math.abs(dy) > .001 ? halfHeight / Math.abs(dy) : Infinity,
  );
  return { x: origin.x + dx * scale, y: origin.y + dy * scale };
}

/** Return a connector whose endpoints remain attached to the two card edges. */
export function elasticConnector(a, b) {
  const aCenter = center(a);
  const bCenter = center(b);
  const start = edgeAnchor(a, bCenter);
  const end = edgeAnchor(b, aCenter);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  const bend = clamp(distance * .38, 54, 238);
  let c1;
  let c2;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const direction = Math.sign(dx) || 1;
    c1 = { x: start.x + bend * direction, y: start.y };
    c2 = { x: end.x - bend * direction, y: end.y };
  } else {
    const direction = Math.sign(dy) || 1;
    c1 = { x: start.x, y: start.y + bend * direction };
    c2 = { x: end.x, y: end.y - bend * direction };
  }
  const d = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
  return {
    d,
    start,
    end,
    distance,
    opacity: clamp(1 - Math.max(0, distance - 330) / 1280, .48, .94),
    width: clamp(2.35 - distance / 1450, 1.45, 2.08),
  };
}

function svg(name, attributes = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

/**
 * Direct-manipulation layout for comparison bubbles. Card offsets are visual
 * session state only: no product decision or persisted matter is mutated.
 */
export function createElasticNodeLayout({ world, list, connectorLayer, getScale = () => 1 }) {
  if (!world || !list || !connectorLayer) throw new TypeError('Elastic node layout requires a world, list and connector layer.');
  let destroyed = false;
  let frame = 0;
  let drag = null;
  let edges = [];
  let cards = [];
  const offsets = new Map();
  const suppressClicks = new WeakSet();
  const listeners = [];

  const add = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  };

  function localRect(card) {
    const offset = offsets.get(card) || { x: 0, y: 0 };
    return {
      x: list.offsetLeft + card.offsetLeft + offset.x,
      y: list.offsetTop + card.offsetTop + offset.y,
      width: card.offsetWidth,
      height: card.offsetHeight,
    };
  }

  function paint() {
    frame = 0;
    if (destroyed) return;
    const rects = cards.map(localRect);
    const groups = [...connectorLayer.querySelectorAll('[data-elastic-edge]')];
    groups.forEach((group, index) => {
      const [from, to] = edges[index] || [];
      if (from == null || to == null) return;
      const geometry = elasticConnector(rects[from], rects[to]);
      group.querySelectorAll('path').forEach(path => {
        path.setAttribute('d', geometry.d);
        path.style.opacity = String(geometry.opacity);
      });
      const core = group.querySelector('.compare-elastic-core');
      if (core) core.style.strokeWidth = String(geometry.width);
      const [startNode, endNode] = group.querySelectorAll('circle');
      if (startNode) {
        startNode.setAttribute('cx', geometry.start.x.toFixed(1));
        startNode.setAttribute('cy', geometry.start.y.toFixed(1));
      }
      if (endNode) {
        endNode.setAttribute('cx', geometry.end.x.toFixed(1));
        endNode.setAttribute('cy', geometry.end.y.toFixed(1));
      }
      group.classList.toggle('is-tensioned', drag && (from === drag.index || to === drag.index));
    });
  }

  function schedulePaint() {
    if (!frame) frame = requestAnimationFrame(paint);
  }

  function rebuildConnectors() {
    cards = [...list.querySelectorAll('.compare-candidate')];
    const rects = cards.map(localRect);
    edges = buildProximityTree(rects);
    connectorLayer.replaceChildren();
    edges.forEach(([from, to], index) => {
      const group = svg('g', { 'data-elastic-edge': `${from}:${to}` });
      const warm = cards[from]?.querySelector('.compare-warm-icon') || cards[to]?.querySelector('.compare-warm-icon');
      if (warm) group.classList.add('compare-elastic-warm');
      group.append(
        svg('path', { class: 'compare-elastic-underlay' }),
        svg('path', { class: 'compare-elastic-core' }),
        svg('circle', { class: 'compare-elastic-node', r: index === 0 ? 7 : 5 }),
        svg('circle', { class: 'compare-elastic-node compare-elastic-node-small', r: 4 }),
      );
      connectorLayer.append(group);
    });
    cards.forEach((card, index) => {
      card.dataset.elasticNode = String(index);
      card.setAttribute('aria-description', '拖动卡片空白处可调整位置，关系线会随之延伸');
    });
    paint();
  }

  function blockedTarget(target) {
    return target.closest?.('button,a,input,textarea,select,[contenteditable="true"]');
  }

  function pointerDown(event) {
    if (event.button !== 0 || blockedTarget(event.target)) return;
    const card = event.target.closest?.('.compare-candidate');
    if (!card || !list.contains(card)) return;
    const index = cards.indexOf(card);
    if (index < 0) return;
    const offset = offsets.get(card) || { x: 0, y: 0 };
    drag = { pointerId: event.pointerId, card, index, startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y, moved: false };
    card.setPointerCapture?.(event.pointerId);
  }

  function pointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const screenDx = event.clientX - drag.startX;
    const screenDy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(screenDx, screenDy) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.card.classList.add('is-node-dragging');
      world.classList.add('is-node-dragging');
      document.getSelection?.()?.removeAllRanges?.();
    }
    event.preventDefault();
    const scale = Math.max(.01, Number(getScale()) || 1);
    const dx = screenDx / scale;
    const dy = screenDy / scale;
    const base = localRect(drag.card);
    const nextX = clamp(drag.originX + dx, drag.originX - base.x + 30, drag.originX + (1672 - 30 - base.width - base.x));
    const nextY = clamp(drag.originY + dy, drag.originY - base.y + 185, drag.originY + (941 - 28 - base.height - base.y));
    offsets.set(drag.card, { x: nextX, y: nextY });
    drag.card.style.transform = `translate3d(${nextX.toFixed(1)}px,${nextY.toFixed(1)}px,0)`;
    schedulePaint();
  }

  function finishDrag(event) {
    if (!drag || (event?.pointerId != null && event.pointerId !== drag.pointerId)) return;
    const completed = drag;
    drag = null;
    completed.card.releasePointerCapture?.(completed.pointerId);
    completed.card.classList.remove('is-node-dragging');
    world.classList.remove('is-node-dragging');
    if (completed.moved) {
      completed.card.classList.add('has-node-position');
      suppressClicks.add(completed.card);
    }
    schedulePaint();
  }

  function suppressDraggedClick(event) {
    const card = event.target.closest?.('.compare-candidate');
    if (!card || !suppressClicks.has(card)) return;
    suppressClicks.delete(card);
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  add(list, 'pointerdown', pointerDown);
  add(list, 'pointermove', pointerMove);
  add(list, 'pointerup', finishDrag);
  add(list, 'pointercancel', finishDrag);
  add(list, 'lostpointercapture', finishDrag);
  add(list, 'click', suppressDraggedClick, true);
  rebuildConnectors();

  return {
    refresh() { rebuildConnectors(); },
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      listeners.splice(0).forEach(remove => remove());
      cards.forEach(card => {
        card.style.removeProperty('transform');
        card.classList.remove('is-node-dragging', 'has-node-position');
        delete card.dataset.elasticNode;
        card.removeAttribute('aria-description');
      });
      connectorLayer.replaceChildren();
      world.classList.remove('is-node-dragging');
      offsets.clear();
    },
  };
}
