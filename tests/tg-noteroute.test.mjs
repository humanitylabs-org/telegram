// node --test tests/tg-noteroute.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeHtml, pickRoute } from '../web/tg-noteroute.js';

// A fake shell WosBell: four stock choices, Morning report disabled for one source.
function bell(routes = {}, { accept = () => true } = {}) {
  const R = { ...routes }, log = [];
  return {
    log, R,
    route: id => R[id] || 'chats',
    setRoute(id, to) { if (!accept(id, to)) return false; R[id] = to; log.push(['set', id, to]); return true; },
    picker: (id, { name }) => ['chats', 'badge', 'daily', 'off'].map(to => `<button data-notify-route="${id}" data-notify-to="${to}" aria-checked="${(R[id] || 'chats') === to}"${to === 'daily' && id === 'money' ? ' disabled' : ''}>${name}:${to}</button>`).join(''),
    ask: (id, name) => `${name} notifications go to`,
    movedToast(id, toast, ms, from) { log.push(['toast', id, ms, from]); toast('●', '', ms); return {}; },
  };
}

test('the note shows every route choice, not only Badge, with the current one checked', () => {
  const B = bell();
  const html = routeHtml(B, { id: 'wizard-calendar', name: 'Calendar' });
  assert.match(html, /Calendar notifications go to/);
  for (const to of ['chats', 'badge', 'daily', 'off']) assert.match(html, new RegExp(`data-notify-to="${to}"`));
  assert.match(html, /data-notify-to="chats" aria-checked="true"/);
  assert.match(routeHtml(B, { id: 'money', name: 'Money' }), /data-notify-to="daily" aria-checked="false" disabled/);
});

test('no picker on an older shell or for Wizard\'s own alerts', () => {
  assert.equal(routeHtml({}, { id: 'x', name: 'X' }), '');
  assert.equal(routeHtml(bell(), null), '');
});

test('the source name is escaped in the ask line', () => {
  const B = { ...bell(), ask: () => '' };
  assert.match(routeHtml(B, { id: 'a', name: '<b>' }), /&lt;b&gt; notifications go to/);
});

for (const to of ['badge', 'daily', 'off']) {
  test(`moving to ${to} saves it, leaves Chats and shows the shell's Undo toast`, () => {
    const B = bell(), toasts = [];
    const r = pickRoute(B, 'wizard-calendar', to, (...a) => toasts.push(a));
    assert.deepEqual(r, { ok: true, changed: true, from: 'chats', leaves: true, undo: true });
    assert.equal(B.R['wizard-calendar'], to);
    assert.deepEqual(B.log.at(-1), ['toast', 'wizard-calendar', 5000, 'chats']);
    assert.equal(toasts.length, 1);
  });
}

test('back to Chats stays in Chats, no toast', () => {
  const B = bell({ m: 'badge' });
  const r = pickRoute(B, 'm', 'chats', () => {});
  assert.deepEqual(r, { ok: true, changed: true, from: 'badge', leaves: false, undo: false });
  assert.equal(B.R.m, 'chats');
});

test('the current choice is a no-op', () => {
  const B = bell();
  assert.deepEqual(pickRoute(B, 'm', 'chats', () => {}), { ok: true, changed: false, from: 'chats', leaves: false, undo: false });
  assert.deepEqual(B.log, []);
});

test('a refused route reports failure and stays put', () => {
  const B = bell({}, { accept: () => false });
  assert.equal(pickRoute(B, 'm', 'off', () => {}).ok, false);
  assert.equal(B.R.m, undefined);
});

test('no shell toast: still moves, caller shows its own Undo', () => {
  const B = bell();
  const r = pickRoute(B, 'm', 'off', null);
  assert.equal(r.ok && r.leaves, true);
  assert.equal(r.undo, false);
});
