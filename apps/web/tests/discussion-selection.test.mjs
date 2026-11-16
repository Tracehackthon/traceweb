import test from 'node:test';
import assert from 'node:assert/strict';

import {
  discussionSelectionAttributes,
  discussionText,
} from '../src/product/chain-screen.mjs';

test('empty discussion guidance is not exposed as selectable persisted content', () => {
  assert.equal(discussionText({}), '');
  assert.equal(discussionText({ text: '   ' }), '   ');

  for (const value of ['', '   ', null, undefined]) {
    const attributes = discussionSelectionAttributes(value);
    assert.doesNotMatch(attributes, /data-selection=/);
    assert.match(attributes, /data-selection-placeholder="discussion"/);
  }
});

test('persisted and derived discussion content remains selectable', () => {
  assert.equal(
    discussionText({ messages: [{ text: '第一段讨论' }], possibility: '第二段讨论' }),
    '第一段讨论\n\n第二段讨论',
  );

  const attributes = discussionSelectionAttributes('第一段讨论');
  assert.match(attributes, /data-selection="discussion"/);
  assert.match(attributes, /tabindex="0"/);
  assert.doesNotMatch(attributes, /data-selection-placeholder=/);
});
