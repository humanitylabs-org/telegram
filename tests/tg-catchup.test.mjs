// node --test tests/tg-catchup.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { catchupRunning, catchupMessage, START_GRACE_MS } from '../web/tg-catchup.js';

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
  assert.match(m.instructions, /fixed phone layout/);
});
