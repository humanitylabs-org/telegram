// node --test tests/tg-asks.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { rowInfo, openAsks, chipText, statusOf } from '../web/tg-asks.js';

const A = (id, ts, state, ask, extra = {}) => ({ id, role: 'assistant', timestamp: ts, content: 'reply', wizard_state: state, wizard_ask: ask, ...extra });
const U = (id, ts) => ({ id, role: 'user', timestamp: ts, content: 'owner' });

test('preview is the newest reply, the older needs_you ask moves to a chip', () => {
  const rows = [U(1, 100), A(2, 110, 'needs_you', 'Reply go to run the side-by-side'), A(3, 120, 'fyi', 'Model picker is in the chat header')];
  const info = rowInfo(rows, null);
  assert.equal(info.preview, 'Model picker is in the chat header');
  assert.equal(info.needs, false);
  assert.deepEqual(info.asks.map(a => [a.mid, a.text, a.older]), [['2', 'Reply go to run the side-by-side', false]]);
  assert.equal(chipText(info.asks), '1 waiting: Reply go to run the side-by-side');
});

test('a later done reply clears the ask; a newer needs_you replaces it', () => {
  assert.deepEqual(openAsks([A(1, 1, 'needs_you', 'Pick A or B'), A(2, 2, 'done', 'Shipped')], null), []);
  assert.deepEqual(openAsks([A(1, 1, 'needs_you', 'Pick A or B'), A(2, 2, 'needs_you', 'Reply ship')], null).map(a => a.text), ['Reply ship']);
});

test('the newest reply being the ask shows it as the preview, with no duplicate chip', () => {
  const info = rowInfo([U(1, 1), A(2, 2, 'needs_you', 'Reply ship to send it')], null);
  assert.equal(info.preview, 'Reply ship to send it');
  assert.equal(info.needs, true);
  assert.deepEqual(info.asks, []);
});

test('two owner messages after an unanswered ask dim it as older', () => {
  const rows = [A(1, 10, 'needs_you', 'Reply go'), U(2, 20), A(3, 21, 'fyi', 'Other topic'), U(4, 30), A(5, 31, 'fyi', 'Still other')];
  const asks = rowInfo(rows, null).asks;
  assert.equal(asks[0].older, true);
  assert.equal(chipText(asks), 'Older ask: Reply go');
});

test('tracker items win over status lines: open needs_you items only, oldest first, dismissed ones out', () => {
  const rows = [A('m1', 10, 'needs_you', 'Old line'), A('m2', 20, 'fyi', 'Latest news')];
  const items = [
    { id: 'logo', title: 'Pick a logo', state: 'needs_you', message_id: 'm2', at: 20 },
    { id: 'copy', title: 'Review copy', ask: 'Reply ok on the copy', state: 'needs_you', message_id: 'm0', at: 5 },
    { id: 'seen', title: 'Dismissed', state: 'needs_you', seen: true, message_id: 'm0', at: 4 },
    { id: 'done', title: 'Finished', state: 'done', message_id: 'm2', at: 20 },
  ];
  const info = rowInfo(rows, items);
  assert.equal(info.preview, 'Latest news');
  // 'logo' sits on the newest reply (already the preview), so only 'copy' is a chip
  assert.deepEqual(info.asks.map(a => a.text), ['Reply ok on the copy']);
});

test('older boxes: the status marker in the reply text still works', () => {
  const st = statusOf({ role: 'assistant', content: 'x\n[WIZARD_STATUS_V1]{"state":"needs_you","ask":"Reply go"}[/WIZARD_STATUS_V1]' });
  assert.deepEqual(st, { state: 'needs_you', ask: 'Reply go' });
});
