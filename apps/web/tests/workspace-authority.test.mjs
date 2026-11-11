import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../src/product/bridge.mjs';
import { assertWorkspaceHost, reconcileWorkspaceAuthority, validateWorkspaceAcknowledgement, workspaceRecoveryExport } from '../src/react/workspace-authority.mjs';

const copy = value => structuredClone(value);
const command = { commandId: 'synthetic-command', expectedRevision: 7 };
const host = () => B.createBridge();

test('authority guard accepts complete snapshots but rejects unsafe shape/tree and revision jumps', () => {
  assertWorkspaceHost(host());
  for (const invalid of [null, {}, { schemaVersion: 1 }, { ...host(), chain: [] }, { ...host(), worksite: {} }, { ...host(), error: { message: 'not a committed snapshot' } }]) {
    assert.throws(() => assertWorkspaceHost(invalid));
  }
  const unsafe = host(); unsafe.extra = JSON.parse('{"__proto__": {"polluted": true}}');
  assert.throws(() => assertWorkspaceHost(unsafe));
  assert.equal({}.polluted, undefined);
  const nonfinite = host(); nonfinite.extra = Infinity;
  assert.throws(() => assertWorkspaceHost(nonfinite));
  assert.throws(() => validateWorkspaceAcknowledgement({ revision: 9, host: host() }, command));
});

test('Product envelope checks are stricter than snapshot compatibility responses', () => {
  const base = { revision: 8, host: host() };
  validateWorkspaceAcknowledgement(base, command);
  assert.throws(() => validateWorkspaceAcknowledgement(base, command, { productCommand: true }));
  const valid = { ...base, headRevision: 8, receipt: { protocolVersion: 1, commandId: command.commandId, status: 'committed', beforeRevision: 7, afterRevision: 8 } };
  validateWorkspaceAcknowledgement(valid, command, { productCommand: true });
  assert.throws(() => validateWorkspaceAcknowledgement({ ...valid, headRevision: 10 }, command, { productCommand: true }));
});

test('three-way reconciliation retains independent local edits and server normalization', () => {
  const base = { nested: { first: 'old', other: 'old' }, removedLocally: 'old' };
  const local = { nested: { first: 'typed', other: 'old' } };
  const remote = { nested: { first: 'old', other: 'normalized' }, removedLocally: 'old', added: 'authority' };
  const result = reconcileWorkspaceAuthority(base, local, remote);
  assert.deepEqual(result, { conflicts: [], host: { nested: { first: 'typed', other: 'normalized' }, added: 'authority' } });
  result.host.nested.first = 'mutated result';
  assert.equal(local.nested.first, 'typed');
  assert.equal(remote.nested.first, 'old');
});

test('same-field and delete-versus-edit conflicts retain paths instead of guessing', () => {
  const result = reconcileWorkspaceAuthority({ text: 'old', item: { text: 'old' } }, { text: 'user' }, { text: 'authority', item: { text: 'changed' } });
  assert.deepEqual(result.conflicts, ['/text', '/item']);
  assert.equal(result.host.text, 'user');
  assert.equal(Object.hasOwn(result.host, 'item'), false);
});

test('arrays are atomic; object key ordering alone does not create conflict', () => {
  const before = { array: [1, 2], record: { a: 1, b: 2 } };
  const current = { array: [1, 2, 3], record: { b: 2, a: 1 } };
  const authority = { array: [1, 4], record: { a: 1, b: 2 }, more: 'server' };
  const result = reconcileWorkspaceAuthority(before, current, authority);
  assert.deepEqual(result.conflicts, ['/array']);
  assert.equal(result.host.more, 'server');
});

test('actual recovery export retains current, submitted, authority, raw ACK and original command separately', () => {
  const recoveryDraft = { revision: 7, host: { text: 'new local' }, submittedHost: { text: 'sent' },
    authoritativeHost: { text: 'observed head ten' }, authoritativeRevision: 10,
    unconfirmedAcknowledgement: { revision: 8, host: { text: 'old ACK eight' } },
    command: { ...command, host: { text: 'sent' } }, conflicts: ['/text'] };
  const result = workspaceRecoveryExport({ revision: 7, host: { text: 'current' }, pending: true, recoveryDraft });
  const decoded = JSON.parse(JSON.stringify(result));
  assert.deepEqual(decoded.recoveryDetails, recoveryDraft);
  assert.equal(decoded.host.text, 'current');
  assert.equal(decoded.recoveryDetails.host.text, 'new local');
  assert.equal(decoded.unsaved, true);
  assert.equal(decoded.recovery, true);
  result.recoveryDetails.host.text = 'mutation';
  assert.equal(recoveryDraft.host.text, 'new local');
});
