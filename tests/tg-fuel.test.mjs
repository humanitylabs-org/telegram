// node --test tests/tg-fuel.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuelHost, partsUrl, viewHref } from '../web/tg-fuel.js';

const tick = () => new Promise(r => setTimeout(r, 0));

function fakeShell({ routed = [], ai = { providers: [] } } = {}) {
  const watched = [];
  return {
    watched, routed,
    document: { baseURI: 'https://box.example/wizard-os-home/desktop.html', querySelectorAll: () => ['live-gauge'] },
    location: { href: 'https://box.example/wizard-os-home/desktop.html' },
    WosResources: { state: { ai, aiError: '', server: { secret: 1 } }, watch: el => watched.push(el) },
    WosModels: { defaultOption: () => ({ provider: 'claude' }) },
    WizCore: { deeplink: { route: href => { routed.push(href); return true; } } },
  };
}
function fakeTimers() {
  const t = { fns: [], cleared: 0, setInterval: fn => (t.fns.push(fn), t.fns.length), clearInterval: () => { t.cleared++; } };
  return t;
}
const doc = { createElement: tag => ({ tag }) };

test('the shell component comes from the shell page itself', () => {
  assert.equal(partsUrl(fakeShell()), 'https://box.example/wizard-os-home/layouts/ai-apps/parts.js');
  assert.equal(partsUrl({}), '/wizard-os-home/layouts/ai-apps/parts.js');
  assert.equal(viewHref(fakeShell(), 'usage'), 'https://box.example/wizard-os-home/desktop.html?view=usage');
});

test('no shell: no gauge', () => {
  assert.equal(fuelHost(null, doc), null);
});

test('mount paints with the shell gaugeInto, its AI usage feed and the default provider, and keeps the feed live', async () => {
  const P = fakeShell(), calls = [], timers = fakeTimers();
  const parts = {
    fuelOf: (state, provider) => ({ state, provider }),
    gaugeInto: (scope, box, last, open, own) => { calls.push({ scope, box, last, open, reading: own() }); box.hidden = false; return 'sig' + calls.length; },
  };
  let asked = '';
  const fuel = fuelHost(P, doc, { importer: async u => { asked = u; return parts; }, timers });
  const box = { isConnected: true, hidden: false };
  fuel.mount(box);
  assert.equal(box.hidden, true, 'hidden until painted');
  assert.deepEqual(P.watched, [box], 'the feed polls while the gauge is on screen');
  await tick(); await tick();
  assert.equal(asked, 'https://box.example/wizard-os-home/layouts/ai-apps/parts.js');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].box, box);
  assert.equal(calls[0].last, '');
  assert.deepEqual(calls[0].reading, { state: { ai: P.WosResources.state.ai, aiError: '' }, provider: 'claude' });
  // the live network Home gauge is looked for on the shell page, the copy is built in this page
  assert.deepEqual(calls[0].scope.querySelectorAll('.mh-gauge'), ['live-gauge']);
  assert.deepEqual(calls[0].scope.createElement('button'), { tag: 'button' });
  timers.fns[0]();
  assert.equal(calls[1].last, 'sig1', 'repaints pass the last signature, so nothing changes unless the reading did');
  box.isConnected = false; timers.fns[0]();
  assert.equal(calls.length, 2, 'a removed box is not painted again');
  assert.equal(timers.cleared, 1);
});

test('a tap opens the same page the sidebar gauge opens', async () => {
  const P = fakeShell();
  const fuel = fuelHost(P, doc, { importer: async () => ({}), timers: fakeTimers() });
  assert.equal(fuel.open('usage'), true);
  assert.equal(fuel.open(), true);
  assert.deepEqual(P.routed, ['https://box.example/wizard-os-home/desktop.html?view=usage', 'https://box.example/wizard-os-home/desktop.html?view=ai']);
});

test('a shell without the component: no gauge and no error', async () => {
  const P = fakeShell(), warn = console.warn; console.warn = () => {};
  try {
    const fuel = fuelHost(P, doc, { importer: async () => { throw new Error('404'); }, timers: fakeTimers() });
    const box = { isConnected: true, hidden: false };
    fuel.mount(box); await tick(); await tick();
    assert.equal(box.hidden, true);
  } finally { console.warn = warn; }
});
