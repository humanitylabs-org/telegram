// node --test tests/tg-catchup.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { catchupRunning, catchupMessage, isCatchupChat, START_GRACE_MS } from '../web/tg-catchup.js';

test('no catch-up yet: not running', () => {
  assert.equal(catchupRunning(null, null), false);
  assert.equal(catchupRunning({}, null), false);
});

test('just sent, chat not in the list yet: running until the grace ends', () => {
  const now = 1_000_000;
  assert.equal(catchupRunning({ id: 's1', at: now - 1000 }, null, now), true);
  assert.equal(catchupRunning({ id: 's1', at: now - START_GRACE_MS - 1 }, null, now), false);
});

test('running while the chat works, done once it stops or is archived', () => {
  const last = { id: 's1', at: 0 };
  for (const status of ['submitting', 'queued', 'running', 'stopping']) assert.equal(catchupRunning(last, { status }), true);
  for (const status of ['idle', 'completed', 'failed', 'interrupted', '']) assert.equal(catchupRunning(last, { status }), false);
  assert.equal(catchupRunning(last, { status: 'running', archived: true }), false);
});

test('message is a fresh pull, no earlier-catch-up logic', () => {
  const m = catchupMessage({ catchup_id: 'cu_20261120_000000_abcdef', chats: 3, notifications: 2 });
  assert.equal(m.text, '\u2728 Catch me up (cu_20261120_000000_abcdef)');
  assert.match(m.instructions, /catchup_list/);
  assert.match(m.instructions, /3 Ready chat\(s\) and 2 unread/);
  assert.doesNotMatch(m.instructions, /catchup_record|previous/);
  assert.match(m.instructions, /two-step layout/);
  assert.match(m.instructions, /Clear all/);
  assert.match(m.instructions, /No tables, no A\/B\/C\/D chunks/);
  assert.doesNotMatch(m.instructions, /app table|### A/);
});

test('follow-ups (wizard-os#758): routed notifications only, Messenger to watch, two sentences of context', () => {
  const m = catchupMessage({ catchup_id: 'cu_20261120_000000_abcdef', chats: 1, notifications: 3 });
  assert.match(m.instructions, /only notifications to cover \(what his routing sends to Chats\)/);
  assert.match(m.instructions, /never read the Notifications app's own inbox or report its unread count/);
  assert.match(m.instructions, /reels, videos and links/);
  assert.match(m.instructions, /"to watch" line \(who sent it, how many\) and stay unread/);
  assert.match(m.instructions, /two short sentences read from the source: who, what was said or decided, what is blocking it/);
  assert.doesNotMatch(m.instructions, /one sentence read from the source/);
});

test('catch-up chat is told by its first message (wizard-os#758)', () => {
  const m = catchupMessage({ catchup_id: 'cu_20261120_000000_abcdef', chats: 0, notifications: 0 });
  assert.equal(isCatchupChat([{ role: 'user', text: m.text }, { role: 'assistant', text: 'x' }]), true);
  assert.equal(isCatchupChat([{ role: 'user', text: 'Catch me up (cu_20261120_000000_abcdef)' }]), true);
  assert.equal(isCatchupChat([{ role: 'assistant', text: 'hi' }, { role: 'user', text: m.text }]), true);
  assert.equal(isCatchupChat([{ role: 'user', text: 'Please catch me up (cu_x) later' }]), false);
  assert.equal(isCatchupChat([{ role: 'user', text: 'Sweep my Ready list: 3 chats (sw_1)' }, { role: 'user', text: m.text }]), false);
  assert.equal(isCatchupChat([]), false);
  assert.equal(isCatchupChat(null), false);
});
