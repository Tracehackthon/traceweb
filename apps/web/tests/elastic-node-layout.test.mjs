import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProximityTree, elasticConnector } from '../src/product/elastic-node-layout.mjs';

test('proximity tree connects every candidate without redundant lines', () => {
  const rects = [
    { x: 0, y: 0, width: 100, height: 80 },
    { x: 180, y: 10, width: 100, height: 80 },
    { x: 380, y: 0, width: 100, height: 80 },
    { x: 20, y: 180, width: 100, height: 80 },
    { x: 220, y: 190, width: 100, height: 80 },
  ];
  const edges = buildProximityTree(rects);
  assert.equal(edges.length, rects.length - 1);
  const reached = new Set(edges.flat());
  assert.deepEqual([...reached].sort(), [0, 1, 2, 3, 4]);
});

test('elastic connector attaches to card edges and changes when a card moves', () => {
  const first = { x: 10, y: 20, width: 200, height: 120 };
  const second = { x: 360, y: 45, width: 180, height: 140 };
  const initial = elasticConnector(first, second);
  const moved = elasticConnector(first, { ...second, x: 900, y: 430 });

  assert.match(initial.d, /^M .+ C .+$/);
  assert.notEqual(initial.d, moved.d);
  assert.ok(initial.start.x > first.x + first.width / 2);
  assert.ok(initial.start.x < first.x + first.width);
  assert.ok(initial.end.x > second.x);
  assert.ok(initial.end.x < second.x + second.width / 2);
  assert.ok(moved.distance > initial.distance);
  assert.ok(moved.opacity < initial.opacity);
  assert.ok(moved.width < initial.width);
});

test('vertical neighbors receive a vertical curve rather than a horizontal kink', () => {
  const upper = { x: 100, y: 30, width: 160, height: 100 };
  const lower = { x: 130, y: 360, width: 160, height: 100 };
  const connector = elasticConnector(upper, lower);
  assert.ok(connector.start.y > upper.y + upper.height / 2);
  assert.ok(connector.end.y < lower.y + lower.height / 2);
  assert.ok(connector.distance > 200);
});
