// node --test tests/tg-popup.test.mjs
// App links open as a pop-up over TG style (wizard-os#796, switch app-popups).
import test from 'node:test';
import assert from 'node:assert/strict';
import { popupHref, openPopup } from '../web/tg-popup.js';

const HERE = 'https://box.example.ts.net/tg-style/';
// A link stand-in: its own attributes, and closest() by the classes/attributes of the elements around it.
function link(href, { inBubble = true, attrs = {}, around = [] } = {}) {
  const all = { href, ...attrs };
  const ups = [...around, ...(inBubble ? ['.bub'] : [])];
  return { getAttribute: k => (k in all ? all[k] : null), hasAttribute: k => k in all, closest: sel => (ups.includes(sel) ? {} : null) };
}

test('a link to another Wizard app in a chat bubble pops up', () => {
  for (const p of ['/messenger/', '/wizard-music/', '/card-benefits/', '/messenger/chat/12?draft=1', 'https://box.example.ts.net/wizard-mail/#inbox'])
    assert.equal(popupHref(link(p), HERE), new URL(p, HERE).href, p);
});

test('every other link keeps its old route', () => {
  const keep = [
    ['outside a bubble', link('/messenger/', { inBubble: false })],
    ['another site', link('https://example.com/messenger/')],
    ['TG style itself', link('/tg-style/?x=1')],
    ['relative inside TG style', link('notes/')],
    ['Wizard itself', link('/wizard-os-home/?session=abc')],
    ['the box root', link('/')],
    ['Wizard API', link('/wizard/files/x')],
    ['a file', link('/wizard-files/report.pdf')],
    ['a picture', link('/messenger/photo.jpg')],
    ['a download', link('/messenger/', { attrs: { download: '' } })],
    ['a thread link', link('/messenger/', { attrs: { 'data-session': 'abc' } })],
    ['Wizard Files', link('/messenger/', { attrs: { 'data-mlink': '' } })],
    ['open in your browser', link('/messenger/', { attrs: { 'data-wizard-browse': '' } })],
    ['inline media', link('/messenger/', { around: ['[data-mi]'] })],
    ['mailto', link('mailto:a@b.c')],
    ['no href', link('')],
  ];
  for (const [name, a] of keep) assert.equal(popupHref(a, HERE), '', name);
  assert.equal(popupHref(null, HERE), '');
});

test('the shell takes it only through WizLinks.popup; an older shell or a refusal keeps the old route', () => {
  const asked = [];
  const shell = { WizLinks: { popup: h => (asked.push(h), true) } };
  assert.equal(openPopup(shell, 'https://box.example.ts.net/messenger/'), true);
  assert.deepEqual(asked, ['https://box.example.ts.net/messenger/']);
  assert.equal(openPopup(shell, ''), false, 'nothing to pop up');
  assert.equal(openPopup({ WizLinks: {} }, 'https://box.example.ts.net/messenger/'), false, 'older shell');
  assert.equal(openPopup(null, 'https://box.example.ts.net/messenger/'), false, 'no shell');
  assert.equal(openPopup({ WizLinks: { popup: () => false } }, 'https://box.example.ts.net/messenger/'), false, 'shell says no');
  assert.equal(openPopup({ WizLinks: { popup: () => { throw new Error('x'); } } }, 'https://box.example.ts.net/messenger/'), false, 'shell throws');
});
