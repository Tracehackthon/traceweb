import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import * as B from '../src/product/bridge.mjs';
import { workspaceRecoveryExport } from '../src/react/workspace-authority.mjs';
import { applyProductOperations, validateProductCommand } from '../../../../trace-runtime/packages/product/workspace/src/index.mjs';
import { loadWebRuntime } from './helpers/load-web-runtime.mjs';

// Synthetic only: no browser profile, user database, native IPC or real Agent.
function browserGlobals() {
  const timers = new Map();
  let timerId = 0;
  const originals = new Map();
  const install = (key, value) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  install('location', new URL('http://localhost/app?view=home'));
  install('history', { state: null, replaceState() {}, pushState() {} });
  install('sessionStorage', { getItem: () => null, setItem() {} });
  install('document', { documentElement: { dataset: {} } });
  install('window', {
    matchMedia: () => ({ matches: false }),
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  return {
    fireTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); },
    restore() { for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; },
  };
}

const copy = value => structuredClone(value);
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const prefs = (host, displayName) => ({ ...copy(host), preferences: { displayName, reduceMotion: false } });
const preferenceOperation = displayName => [{ type: 'preferences.update', displayName, reduceMotion: false }];
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function until(condition, message) {
  for (let i = 0; i < 100; i++) { if (condition()) return; await nextTurn(); }
  assert.fail(message);
}

async function fixture(t, { native = true } = {}) {
  const browser = browserGlobals();
  const initial = prefs(B.createBridge(), 'initial');
  const writes = [];
  const responses = [];
  const readResponses = [];
  // Explicit responder: only callers choosing ack() receive a valid envelope.
  // Deliberately malformed responses remain malformed; transport never repairs them.
  const ack = (host, revision, { headRevision = revision, mutate } = {}) => body => {
    const envelope = { revision, host: copy(host), storage: { location: 'authority' } };
    if (native) {
      envelope.headRevision = headRevision;
      envelope.receipt = {
        protocolVersion: 1, receiptId: `product:${body.commandId}`, commandId: body.commandId,
        status: 'committed', beforeRevision: body.expectedRevision, afterRevision: revision,
        requestHash: 'synthetic-request-hash', hostDelivery: 'not_requested',
      };
    }
    mutate?.(envelope);
    return response(envelope);
  };
  const transport = async (kind, body) => {
    writes.push({ kind, body: copy(body) });
    const handler = responses.shift();
    assert.ok(handler, 'Every synthetic write needs an explicit response');
    return typeof handler === 'function' ? handler(body) : handler;
  };
  const loaded = await loadWebRuntime({
    native,
    workspaceRequest: async (_url, options = {}) => options.method === 'PUT'
      ? transport('workspace', JSON.parse(options.body))
      : readResponses.length ? readResponses.shift()
        : response({ revision: 7, host: copy(initial), storage: { location: 'synthetic' } }),
    productCommandRequest: body => transport('product', body),
  });
  const runtime = new loaded.WebRuntime();
  t.after(() => { loaded.dispose(); browser.restore(); });
  await runtime.start();
  assert.equal(runtime.getSnapshot().revision, 7);
  assert.equal(runtime.getSnapshot().pending, false);
  return { runtime, initial, writes, responses, readResponses, ack, fireTimers: browser.fireTimers };
}

for (const native of [true, false]) {
  test(`authority host reaches commit callback and next transform (${native ? 'native command' : 'browser snapshot'})`, async t => {
    const { runtime, initial, writes, responses, ack } = await fixture(t, { native });
    const authoritative = prefs(initial, 'server normalized');
    responses.push(ack(authoritative, 8));
    let callbackHost;
    await runtime.commit(host => prefs(host, 'local proposal'), host => { callbackHost = copy(host); }, preferenceOperation('local proposal'));
    assert.equal(writes[0].kind, native ? 'product' : 'workspace');
    assert.deepEqual(callbackHost, authoritative, 'callback must receive returned authority, not captured local next');
    assert.deepEqual(runtime.getHost(), authoritative, 'committed snapshot must be authority');
    let nextInput;
    responses.push(ack(authoritative, 9));
    await runtime.commit(host => { nextInput = copy(host); return host; }, undefined, preferenceOperation('server normalized'));
    assert.deepEqual(nextInput, authoritative, 'next command must start from authoritative host');
    assert.equal(writes[1].body.expectedRevision, 8);
    assert.equal(runtime.getSnapshot().pending, false);
  });

  test(`next command independently observes returned authority (${native ? 'native command' : 'browser snapshot'})`, async t => {
    const { runtime, initial, writes, responses, ack } = await fixture(t, { native });
    const authority = prefs(initial, 'server normalized');
    responses.push(ack(authority, 8));
    await runtime.commit(host => prefs(host, 'local proposal'), undefined, preferenceOperation('local proposal'));
    let nextInput;
    responses.push(ack(authority, 9));
    await runtime.commit(host => { nextInput = copy(host); return host; }, undefined, preferenceOperation('server normalized'));
    assert.equal(writes[1].body.expectedRevision, 8);
    assert.deepEqual(nextInput, authority, 'actual next public commit transform must see authority, not previous local proposal');
  });
}

test('in-flight draft acknowledgement rebases authority without losing newer draft or its operation', async t => {
  const { runtime, initial, writes, responses, fireTimers, ack } = await fixture(t);
  const first = deferred();
  responses.push(() => first.promise);
  runtime.onHomeDraft('first local draft');
  fireTimers();
  await until(() => writes.length === 1, 'first draft must reach actual save');
  runtime.onHomeDraft('newer user draft');
  const authority = prefs(initial, 'server side preference');
  authority.chain.capture.text = 'first local draft';
  first.resolve(ack(authority, 8)(writes[0].body));
  await until(() => runtime.getSnapshot().revision === 8, 'first acknowledgement must settle');
  assert.equal(runtime.getHost().chain.capture.text, 'newer user draft');
  assert.equal(runtime.getHost().preferences.displayName, 'server side preference', 'authority fields must survive local draft overlay');
  assert.equal(runtime.getSnapshot().pending, true, 'new draft is not acknowledged by older response');
  const final = copy(authority); final.chain.capture.text = 'newer user draft';
  responses.push(ack(final, 9));
  fireTimers();
  await until(() => runtime.getSnapshot().revision === 9, 'newer draft must save');
  assert.deepEqual(writes[1].body.operations, [{ type: 'capture.draft', text: 'newer user draft' }]);
  assert.equal(writes[1].body.expectedRevision, 8);
  await until(() => !runtime.getSnapshot().pending, 'all acknowledged drafts become saved');
  assert.deepEqual(runtime.getHost(), final);
});

test('in-flight commit does not overwrite user drafts created after dispatch', async t => {
  const { runtime, initial, writes, responses, fireTimers, ack } = await fixture(t);
  const first = deferred(); responses.push(() => first.promise);
  const committing = runtime.commit(host => prefs(host, 'local proposal'), undefined, preferenceOperation('local proposal'));
  await until(() => writes.length === 1, 'commit must dispatch');
  runtime.onHomeDraft('typed during commit');
  const authority = prefs(initial, 'server normalized');
  first.resolve(ack(authority, 8)(writes[0].body));
  await committing;
  assert.equal(runtime.getHost().chain.capture.text, 'typed during commit', 'commit finish must not restore stale next');
  assert.equal(runtime.getHost().preferences.displayName, 'server normalized');
  assert.equal(runtime.getSnapshot().pending, true);
  const final = copy(authority); final.chain.capture.text = 'typed during commit';
  responses.push(ack(final, 9));
  fireTimers();
  await until(() => writes.length === 2, 'newer draft must be dispatched, not falsely marked saved');
  assert.deepEqual(writes[1].body.operations, [{ type: 'capture.draft', text: 'typed during commit' }]);
  await until(() => !runtime.getSnapshot().pending, 'newer draft acknowledged');
  assert.deepEqual(runtime.getHost(), final);
});

test('uncertain acknowledgement retries the identical commandId and uses returned authority', async t => {
  const { runtime, initial, writes, responses, ack } = await fixture(t);
  responses.push(() => { throw new Error('Synthetic connection lost after possible commit'); });
  let callbackHost;
  await runtime.commit(host => prefs(host, 'local proposal'), host => { callbackHost = copy(host); }, preferenceOperation('local proposal'));
  assert.equal(runtime.getSnapshot().pending, true);
  assert.equal(callbackHost, undefined);
  const authority = prefs(initial, 'replayed authority');
  responses.push(ack(authority, 8));
  await runtime.retryPending();
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].body, writes[0].body, 'retry must preserve commandId, expectedRevision and operations');
  assert.deepEqual(callbackHost, authority);
  assert.deepEqual(runtime.getHost(), authority);
  assert.equal(runtime.getSnapshot().pending, false);
});

test('control: identical authority retry preserves command identity and calls continuation once', async t => {
  const { runtime, initial, writes, responses, ack } = await fixture(t);
  responses.push(() => { throw new Error('Synthetic uncertain delivery'); });
  let calls = 0;
  await runtime.commit(host => prefs(host, 'local proposal'), () => { calls++; }, preferenceOperation('local proposal'));
  assert.equal(calls, 0);
  const sameAsLocal = prefs(initial, 'local proposal');
  responses.push(ack(sameAsLocal, 8));
  await runtime.retryPending();
  await runtime.retryPending();
  assert.equal(writes.length, 2, 'retry after confirmation must not issue a third command');
  assert.deepEqual(writes[1].body, writes[0].body);
  assert.equal(calls, 1);
  assert.equal(runtime.getSnapshot().pending, false);
});

const invalidAcknowledgements = [
  ['missing host', host => ({ revision: 8 })],
  ['null host', host => ({ revision: 8, host: null })],
  ['invalid host shape', host => ({ revision: 8, host: { schemaVersion: 1 } })],
  ['missing revision', host => ({ host })],
  ['string revision', host => ({ revision: '8', host })],
  ['negative revision', host => ({ revision: -1, host })],
  ['fractional revision', host => ({ revision: 8.5, host })],
  ['regressed revision', host => ({ revision: 6, host })],
  ['unchanged revision', host => ({ revision: 7, host })],
];
for (const [name, body] of invalidAcknowledgements) {
  test(`invalid acknowledgement (${name}) stays pending and never reports saved`, async t => {
    const { runtime, initial, responses, ack } = await fixture(t);
    responses.push(ack(prefs(initial, 'authority'), 8, { mutate: envelope => {
      const invalid = body(prefs(initial, 'authority'));
      delete envelope.host;
      delete envelope.revision;
      Object.assign(envelope, invalid);
    } }));
    let callbackCalled = false;
    await runtime.commit(host => prefs(host, 'local proposal'), () => { callbackCalled = true; }, preferenceOperation('local proposal'));
    assert.equal(callbackCalled, false, 'invalid acknowledgement must not run successful continuation');
    assert.equal(runtime.getSnapshot().status.state, 'error');
    assert.equal(runtime.getSnapshot().pending, true, 'preserve retry payload rather than pretend save');
    assert.equal(runtime.getSnapshot().revision, 7, 'invalid acknowledgement cannot advance or poison revision');
    assert.deepEqual(runtime.getHost(), initial, 'unconfirmed commit must not replace confirmed host');
  });
}

test('historical idempotent receipt with newer head stays recoverable without success continuation or new writes', async t => {
  const { runtime, initial, writes, responses, ack } = await fixture(t);
  const historical = prefs(initial, 'historical committed value');
  responses.push(ack(historical, 8, { headRevision: 10 }));
  let callbacks = 0;
  await runtime.commit(host => prefs(host, 'local proposal'), () => { callbacks++; }, preferenceOperation('local proposal'));
  assert.equal(callbacks, 0, 'historical success is not current head and must not continue a business action');
  assert.equal(runtime.getSnapshot().pending, true);
  assert.equal(runtime.getSnapshot().status.state, 'error');
  // A later public action must not silently branch from revision 8 as though it were head 10.
  await runtime.commit(host => prefs(host, 'next action'), undefined, preferenceOperation('next action'));
  assert.equal(writes.length, 1, 'unreconciled historical receipt must block new writes');
});

test('same-field in-flight conflict preserves exportable local and authority instead of silently resolving', async t => {
  const { runtime, initial, writes, responses, fireTimers, ack } = await fixture(t);
  const first = deferred(); responses.push(() => first.promise);
  runtime.onHomeDraft('sent draft'); fireTimers();
  await until(() => writes.length === 1, 'draft dispatched before concurrent input');
  runtime.onHomeDraft('new local draft');
  const authority = copy(initial); authority.chain.capture.text = 'authority divergent draft';
  first.resolve(ack(authority, 8)(writes[0].body));
  await until(() => runtime.getSnapshot().revision !== 7 || runtime.getSnapshot().status.state === 'error', 'acknowledgement settles');
  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.status.state, 'error', 'same-field conflict cannot be silently declared saved');
  assert.equal(snapshot.pending, true);
  // Check only the public exportable snapshot, without prescribing recovery helper/field names.
  const serialized = JSON.stringify(snapshot);
  assert.ok(serialized.includes('new local draft'), 'new local input remains available for export/recovery');
  assert.ok(serialized.includes('authority divergent draft'), 'authority counterpart remains available for export/recovery');
});

test('pending retry identity survives retryLoad observing a newer head', async t => {
  const { runtime, initial, writes, responses, readResponses, ack } = await fixture(t);
  responses.push(() => { throw new Error('Synthetic uncertain delivery before refresh'); });
  await runtime.commit(host => prefs(host, 'local proposal'), undefined, preferenceOperation('local proposal'));
  assert.equal(runtime.getSnapshot().pending, true);
  readResponses.push(response({ revision: 10, host: prefs(initial, 'new head'), storage: { location: 'authority' } }));
  await runtime.retryLoad();
  assert.equal(runtime.getSnapshot().pending, true, 'refresh cannot discard uncertain command');
  responses.push(ack(prefs(initial, 'local proposal'), 8, { headRevision: 10 }));
  await runtime.retryPending();
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].body, writes[0].body, 'retry keeps original expectedRevision and commandId even after head read (or safely blocked head advance)');
});

test('malformed 200 can retry a valid receipt and continuation executes exactly once', async t => {
  const { runtime, initial, writes, responses, ack } = await fixture(t);
  let callbacks = 0;
  let callbackHost;
  responses.push(ack(undefined, 8)); // Explicitly missing host, otherwise valid Product receipt.
  await runtime.commit(host => prefs(host, 'local proposal'), host => { callbacks++; callbackHost = copy(host); }, preferenceOperation('local proposal'));
  assert.equal(callbacks, 0, 'malformed success cannot consume continuation');
  assert.equal(runtime.getSnapshot().pending, true);
  const authority = prefs(initial, 'valid recovered authority');
  responses.push(ack(authority, 8));
  await runtime.retryPending();
  await runtime.retryPending();
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].body, writes[0].body);
  assert.equal(callbacks, 1);
  assert.deepEqual(callbackHost, authority);
  assert.deepEqual(runtime.getHost(), authority);
  assert.equal(runtime.getSnapshot().pending, false);
});

test('capture follows requested object route even when authoritative persisted route is normalized home', async t => {
  const { runtime, initial, writes, responses, ack } = await fixture(t);
  let createdId;
  responses.push(body => {
    const operation = body.operations.find(operation => operation.type === 'capture.create');
    assert.ok(operation, 'actual public capture emits create command');
    createdId = operation.matterId;
    const authority = B.captureInput(initial, { matterId: createdId, text: operation.text });
    authority.route = { view: 'home' }; // Actual Product persistence normalizes UI route.
    authority.preferences = { displayName: 'server normalized', reduceMotion: false };
    return ack(authority, 8)(body);
  });
  runtime.onCapture('synthetic capture with normalized storage route');
  await until(() => writes.length === 1 && !runtime.getSnapshot().busy, 'public capture completes');
  assert.equal(runtime.getRoute().view, 'chain', 'persisted home route must not redirect successful capture home');
  assert.equal(runtime.getRoute().matterId, createdId);
  assert.equal(runtime.matter()?.originalText, 'synthetic capture with normalized storage route');
  assert.equal(runtime.getHost().preferences.displayName, 'server normalized', 'route compatibility must not discard authority business state');
});

const invalidProductReceipts = [
  ['missing receipt', envelope => { delete envelope.receipt; }],
  ['missing headRevision', envelope => { delete envelope.headRevision; }],
  ['wrong commandId', envelope => { envelope.receipt.commandId = 'another-command'; }],
  ['wrong beforeRevision', envelope => { envelope.receipt.beforeRevision = 6; }],
  ['wrong afterRevision', envelope => { envelope.receipt.afterRevision = 9; }],
  ['wrong status', envelope => { envelope.receipt.status = 'prepared'; }],
  ['wrong protocol', envelope => { envelope.receipt.protocolVersion = 2; }],
];
for (const [name, mutate] of invalidProductReceipts) {
  test(`Product acknowledgement (${name}) rejects without success continuation`, async t => {
    const { runtime, initial, responses, ack } = await fixture(t, { native: true });
    responses.push(ack(prefs(initial, 'authority'), 8, { mutate }));
    let callbacks = 0;
    await runtime.commit(host => prefs(host, 'local proposal'), () => { callbacks++; }, preferenceOperation('local proposal'));
    assert.equal(callbacks, 0);
    assert.equal(runtime.getSnapshot().status.state, 'error');
    assert.equal(runtime.getSnapshot().pending, true);
    assert.equal(runtime.getSnapshot().revision, 7);
    assert.deepEqual(runtime.getHost(), initial);
  });
}

test('same-tick timer and public commit flush each draft batch only once', async t => {
  const { runtime, initial, writes, responses, fireTimers, ack } = await fixture(t);
  const draftAuthority = copy(initial); draftAuthority.chain.capture.text = 'single queued draft';
  responses.push(ack(draftAuthority, 8));
  responses.push(ack(prefs(draftAuthority, 'next command'), 9));
  runtime.onHomeDraft('single queued draft');
  fireTimers();
  // Both public entrypoints enter flush before its first transport promise settles.
  await runtime.commit(host => prefs(host, 'next command'), undefined, preferenceOperation('next command'));
  await until(() => !runtime.getSnapshot().pending, 'both requested actions acknowledged');
  assert.equal(writes.length, 2, 'one draft write plus one commit, never duplicate draft writes');
  assert.deepEqual(writes[0].body.operations, [{ type: 'capture.draft', text: 'single queued draft' }]);
  assert.deepEqual(writes[1].body.operations, preferenceOperation('next command'));
  assert.equal(writes[0].body.expectedRevision, 7);
  assert.equal(writes[1].body.expectedRevision, 8);
});

test('editing through public capture draft while saved-workspace read is in flight is recoverable', async t => {
  const { runtime, initial, readResponses } = await fixture(t);
  const read = deferred(); readResponses.push(read.promise);
  const loading = runtime.loadSaved();
  runtime.onHomeDraft('new input during saved-workspace read');
  read.resolve(response({ revision: 9, host: prefs(initial, 'loaded authority'), storage: { location: 'authority' } }));
  await loading;
  // UI/export snapshot may keep the draft active or retain it as explicit recovery.
  // It may not silently drop input merely because the read started first.
  const snapshot = runtime.getSnapshot();
  assert.ok(JSON.stringify(snapshot).includes('new input during saved-workspace read'), 'input remains publicly recoverable');
  assert.ok(snapshot.pending || snapshot.recoveryDraft, 'new input cannot be falsely acknowledged by a read');
  // Do not fire the queued draft timer: this test is a read/edit race, not a synthetic write.
});

for (const variant of ['newer distinct host', 'newer same host', 'initial revision and host']) {
  test(`late browser PUT acknowledgement cannot alter explicit loadSaved (${variant})`, async t => {
    const { runtime, initial, writes, responses, readResponses, fireTimers, ack } = await fixture(t, { native: false });
    const saving = deferred(); responses.push(() => saving.promise);
    runtime.onHomeDraft('old in-flight browser draft'); fireTimers();
    await until(() => writes.length === 1, 'automatic browser PUT dispatched');
    assert.equal(writes[0].kind, 'workspace');
    assert.equal(writes[0].body.expectedRevision, 7);
    const loadedHost = variant === 'newer distinct host' ? prefs(initial, 'explicitly loaded head')
      : variant === 'newer same host' ? copy(writes[0].body.host) : copy(initial);
    const loadedRevision = variant === 'initial revision and host' ? 7 : 9;
    readResponses.push(response({ revision: loadedRevision, host: loadedHost, storage: { location: 'explicit-load' } }));
    await runtime.loadSaved();
    assert.deepEqual(runtime.getHost(), loadedHost);
    assert.equal(runtime.getSnapshot().revision, loadedRevision);
    const loadedSnapshot = copy(runtime.getSnapshot());
    saving.resolve(ack(writes[0].body.host, 8)(writes[0].body));
    for (let i = 0; i < 5; i++) await nextTurn();
    assert.deepEqual(runtime.getSnapshot(), loadedSnapshot, 'obsolete PUT cannot replace loaded host/revision/status or resurrect old pending state');
    await runtime.retryPending();
    assert.equal(writes.length, 1, 'obsolete acknowledgement cannot restore an old continuation or retry envelope');
  });
}

for (const native of [false, true]) {
  test(`observed head 10 blocks late ACK 8 even when acknowledgement ${native ? 'reports only head 8' : 'omits head'}`, async t => {
    const { runtime, initial, writes, responses, readResponses, fireTimers, ack } = await fixture(t, { native });
    const saving = deferred(); responses.push(() => saving.promise);
    runtime.onHomeDraft('pending at base seven'); fireTimers();
    await until(() => writes.length === 1, 'pending write dispatched');
    readResponses.push(response({ revision: 10, host: prefs(initial, 'observed current head ten'), storage: { location: 'head-read' } }));
    await runtime.retryLoad();
    assert.equal(runtime.getSnapshot().revision, 7, 'read observation alone must not rebase uncertain command');
    assert.equal(runtime.getSnapshot().pending, true);
    const authority = copy(initial); authority.chain.capture.text = 'pending at base seven';
    saving.resolve(ack(authority, 8)(writes[0].body));
    for (let i = 0; i < 5; i++) await nextTurn();
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.status.state, 'error', 'ack head cannot erase already observed newer head');
    assert.equal(snapshot.pending, true);
    assert.equal(snapshot.revision, 7, 'historical acknowledgement must not become active write base');
    assert.ok(JSON.stringify(snapshot).includes('observed current head ten'), 'newer authority remains recoverable');
  });
}

test('debounce fired during pending commit is rescheduled after ACK without another keystroke', async t => {
  const { runtime, initial, writes, responses, fireTimers, ack } = await fixture(t);
  const saving = deferred(); responses.push(() => saving.promise);
  const committing = runtime.commit(host => prefs(host, 'local proposal'), undefined, preferenceOperation('local proposal'));
  await until(() => writes.length === 1, 'commit dispatched before typing');
  runtime.onHomeDraft('typed once while commit waits');
  fireTimers(); // The only original debounce expires before the old command ACK.
  for (let i = 0; i < 3; i++) await nextTurn();
  assert.equal(writes.length, 1, 'pending command prevents premature draft save');
  const authority = prefs(initial, 'server normalized');
  const final = copy(authority); final.chain.capture.text = 'typed once while commit waits';
  responses.push(ack(final, 9));
  saving.resolve(ack(authority, 8)(writes[0].body));
  await committing;
  fireTimers(); // Advance only a newly scheduled debounce; no new draft/input call.
  await until(() => writes.length === 2, 'remaining draft must be rescheduled after commit ACK');
  assert.deepEqual(writes[1].body.operations, [{ type: 'capture.draft', text: 'typed once while commit waits' }]);
  assert.equal(writes[1].body.expectedRevision, 8);
  await until(() => !runtime.getSnapshot().pending, 'rescheduled draft saves without another keystroke');
  assert.deepEqual(runtime.getHost(), final);
});

test('recovery export after loadSaved retains newer current draft plus older recovery command and submission', async t => {
  const { runtime, initial, writes, responses, readResponses, fireTimers } = await fixture(t);
  responses.push(response({ error: { code: 'STORAGE_FAILURE', message: 'Synthetic save unavailable' } }, 503));
  runtime.onHomeDraft('OLD_RECOVERY_A');
  fireTimers();
  await until(() => writes.length === 1 && runtime.getSnapshot().status.state === 'error', 'old draft save fails visibly');
  assert.equal(runtime.getSnapshot().pending, true);
  const originalCommand = copy(writes[0].body);
  readResponses.push(response({ revision: 7, host: copy(initial), storage: { location: 'explicit-load' } }));
  await runtime.loadSaved();
  assert.equal(runtime.getSnapshot().revision, 7);
  assert.equal(runtime.getSnapshot().pending, false, 'explicit load clears the old pending command');
  assert.ok(JSON.stringify(runtime.getSnapshot().recoveryDraft).includes('OLD_RECOVERY_A'), 'old recovery remains available after load');
  runtime.onHomeDraft('NEW_CURRENT_B');
  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.host.chain.capture.text, 'NEW_CURRENT_B');
  const exported = workspaceRecoveryExport(snapshot);
  assert.equal(exported.host.chain.capture.text, 'NEW_CURRENT_B', 'current exported host cannot be replaced by stale recovery.host');
  const serialized = JSON.stringify(exported);
  assert.ok(serialized.includes('NEW_CURRENT_B'), 'new unsaved current input must be exported');
  assert.ok(serialized.includes('OLD_RECOVERY_A'), 'older recovery input must also be exported');
  // Find the command by its existing identity, without naming any new recovery fields.
  const objects = [];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    objects.push(value);
    for (const child of Object.values(value)) visit(child);
  };
  visit(exported);
  const retainedCommand = objects.find(value => value.commandId === originalCommand.commandId);
  assert.ok(retainedCommand, 'original command remains recoverable');
  assert.equal(retainedCommand.expectedRevision, originalCommand.expectedRevision);
  assert.deepEqual(retainedCommand.operations, originalCommand.operations);
  assert.ok(objects.some(value => value.chain?.capture?.text === 'OLD_RECOVERY_A'), 'original submitted content remains recoverable, not just its label');
  assert.equal(exported.unsaved, true);
});

test('public commit awaiting draft A must actually submit draft B before acknowledging its generation', async t => {
  const { runtime, initial, writes, responses, ack } = await fixture(t);
  let serverHost = copy(initial);
  let serverRevision = 7;
  const appliedOperations = [];
  const executeActualOperations = body => {
    validateProductCommand(body);
    assert.equal(body.expectedRevision, serverRevision, 'synthetic authority enforces actual CAS');
    serverHost = applyProductOperations(serverHost, body.operations);
    appliedOperations.push(...copy(body.operations));
    serverRevision++;
    return ack(serverHost, serverRevision)(body);
  };
  const firstAcknowledgement = deferred();
  responses.push(body => {
    const result = executeActualOperations(body);
    return firstAcknowledgement.promise.then(() => result);
  });
  // Accept either a separate B flush or an explicit B+preferences batch.
  // No response invents draft B: authority evolves only from received operations.
  responses.push(executeActualOperations, executeActualOperations);
  runtime.onHomeDraft('DRAFT_A_GENERATION_1');
  let callbacks = 0;
  let callbackHost;
  const committing = runtime.commit(host => prefs(host, 'preference after drafts'), host => {
    callbacks++;
    callbackHost = copy(host);
  }, preferenceOperation('preference after drafts'));
  await until(() => writes.length === 1, 'commit public path first flushes draft A');
  assert.deepEqual(writes[0].body.operations, [{ type: 'capture.draft', text: 'DRAFT_A_GENERATION_1' }]);
  runtime.onHomeDraft('DRAFT_B_GENERATION_2');
  firstAcknowledgement.resolve();
  await committing;
  assert.ok(appliedOperations.some(operation => operation.type === 'capture.draft' && operation.text === 'DRAFT_B_GENERATION_2'),
    'draft B generation cannot become saved through preferences-only operations');
  assert.equal(callbacks, 1);
  assert.equal(callbackHost.chain.capture.text, 'DRAFT_B_GENERATION_2', 'business callback observes actually saved B');
  assert.equal(serverHost.chain.capture.text, 'DRAFT_B_GENERATION_2');
  assert.equal(runtime.getHost().chain.capture.text, 'DRAFT_B_GENERATION_2');
  assert.equal(runtime.getHost().preferences.displayName, 'preference after drafts');
  assert.equal(runtime.getSnapshot().pending, false);
  assert.deepEqual(runtime.getHost(), serverHost);
});

for (const phase of ['request response', 'JSON receipt']) {
  test(`save ${phase} timeout preserves frozen request and valid retry continues once`, async t => {
    const { runtime, initial, writes, responses, ack } = await fixture(t);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.after(() => t.mock.timers.reset());
    const hanging = deferred();
    let jsonStarted = false;
    responses.push(phase === 'request response' ? () => hanging.promise : () => ({
      ok: true,
      status: 200,
      json() { jsonStarted = true; return hanging.promise; },
    }));
    let callbacks = 0;
    let callbackHost;
    const committing = runtime.commit(host => prefs(host, 'proposal pending timeout'), host => {
      callbacks++;
      callbackHost = copy(host);
    }, preferenceOperation('proposal pending timeout'));
    await until(() => writes.length === 1 && (phase === 'request response' || jsonStarted), 'actual save reaches hanging transport phase');
    const timeoutMs = phase === 'request response' ? 12_000 : 2_000;
    t.mock.timers.tick(timeoutMs - 1);
    for (let i = 0; i < 3; i++) await nextTurn();
    assert.equal(runtime.getSnapshot().busy, true, 'save remains in flight before the actual timeout boundary');
    assert.equal(callbacks, 0);
    t.mock.timers.tick(1);
    await until(() => !runtime.getSnapshot().busy, 'timeout releases public commit busy state');
    await committing;
    const timedOut = runtime.getSnapshot();
    assert.equal(timedOut.status.state, 'error');
    assert.equal(timedOut.pending, true);
    assert.equal(timedOut.revision, 7);
    assert.deepEqual(timedOut.host, initial);
    assert.equal(callbacks, 0, 'timeout cannot execute successful continuation');
    assert.equal(timedOut.recoveryDraft.command.commandId, writes[0].body.commandId);
    assert.equal(timedOut.recoveryDraft.command.expectedRevision, writes[0].body.expectedRevision);
    assert.deepEqual(timedOut.recoveryDraft.command.operations, writes[0].body.operations);
    assert.equal(timedOut.recoveryDraft.submittedHost.preferences.displayName, 'proposal pending timeout');
    const authority = prefs(initial, 'confirmed through same command retry');
    responses.push(ack(authority, 8));
    await runtime.retryPending();
    await runtime.retryPending();
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1].body, writes[0].body, 'timeout retry must not generate another command identity or base revision');
    assert.equal(callbacks, 1);
    assert.deepEqual(callbackHost, authority);
    assert.deepEqual(runtime.getHost(), authority);
    assert.equal(runtime.getSnapshot().busy, false);
    assert.equal(runtime.getSnapshot().pending, false);
    assert.equal(runtime.getSnapshot().status.state, 'saved');
  });
}
