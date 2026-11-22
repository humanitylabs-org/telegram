// node --test tests/tg-copy.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { copyTarget, copyText, flash } from '../web/tg-copy.js';

// A tiny element stand-in: closest/matches by attribute or class, enough for the shell's code and quote markup.
function el(attrs = {}, parent = null, extra = {}) {
  const e = { attrs, parent, dataset: extra.dataset || {}, className: extra.className || '', textContent: extra.text || '', ...extra };
  const hit = sel => sel.split(',').some(one => {
    one = one.trim();
    const a = one.match(/^\[([\w-]+)\]$/); if (a) return a[1] in e.attrs;
    const bq = one.match(/^blockquote\[data-quote-source\]$/); if (bq) return e.tag === 'blockquote' && 'quoteSource' in e.dataset;
    const c = one.match(/^\.([\w-]+)(?:\.([\w-]+))?$/); if (c) return e.className.split(' ').includes(c[1]) && (!c[2] || e.className.split(' ').includes(c[2]));
    return false;
  });
  e.matches = hit;
  e.closest = sel => { for (let x = e; x; x = x.parent) if (x.matches(sel)) return x; return null; };
  return e;
}
function codeBlock(code) {
  const pre = { textContent: code };
  const block = el({}, el({}, null, { className: 'msg a' }), { className: 'code', querySelector: s => s === 'pre' ? pre : null });
  const head = el({}, block, { className: 'code-h' });
  return { copy: el({ 'data-codecopy': '' }, head, { text: 'Copy' }), share: el({ 'data-codeshare': '' }, head, { text: 'Share' }) };
}

test('a code block Copy copies the code', () => {
  const { copy, share } = codeBlock('npm install\nnpm test');
  assert.deepEqual({ ...copyTarget(copy), button: null }, { button: null, action: 'copy', kind: 'code', text: 'npm install\nnpm test' });
  assert.equal(copyTarget(share).action, 'share');
});

test('a quote Copy copies the quote source', () => {
  const bq = el({}, null, { tag: 'blockquote', dataset: { quoteSource: 'quoted words' } });
  const b = el({ 'data-quotecopy': '' }, el({}, bq, { className: 'quote-actions' }));
  assert.equal(copyTarget(b).text, 'quoted words');
  assert.equal(copyTarget(b).kind, 'quote');
});

test('other taps are not ours', () => {
  assert.equal(copyTarget(el({ 'data-chopen': '' })), null);
  assert.equal(copyTarget(null), null);
});

test('the frame’s own clipboard is used first', async () => {
  const got = [];
  const ok = await copyText('x', { nav: { clipboard: { writeText: async t => { got.push(t); } } }, doc: null, shell: () => { throw new Error('not reached'); } });
  assert.equal(ok, true); assert.deepEqual(got, ['x']);
});

test('a refused clipboard falls back to the textarea, then the shell', async () => {
  const refused = { clipboard: { writeText: async () => { throw new Error('NotAllowedError'); } } };
  const body = { kids: [], appendChild(n) { this.kids.push(n); n.remove = () => { body.kids = body.kids.filter(k => k !== n); }; } };
  const doc = ok => ({ body, createElement: () => ({ style: {}, setAttribute() {}, select() {}, setSelectionRange() {} }), execCommand: c => c === 'copy' && ok });
  assert.equal(await copyText('y', { nav: refused, doc: doc(true) }), true);
  assert.equal(body.kids.length, 0, 'the helper textarea is removed');
  const shelled = [];
  assert.equal(await copyText('z', { nav: refused, doc: doc(false), shell: async t => { shelled.push(t); return true; } }), true);
  assert.deepEqual(shelled, ['z']);
  assert.equal(await copyText('z', { nav: refused, doc: doc(false), shell: async () => false }), false, 'every way refused says so');
  assert.equal(await copyText('z', { nav: {}, doc: null }), false);
});

test('the button says what happened, then its own word again', async () => {
  const b = { dataset: {}, textContent: 'Copy' };
  flash(b, 'Copied', 5); assert.equal(b.textContent, 'Copied');
  flash(b, 'Couldn’t copy', 5); assert.equal(b.textContent, 'Couldn’t copy');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(b.textContent, 'Copy');
});

test('the window listens for the shell’s code and quote buttons', () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.match(app, /from '\.\/tg-copy\.js'/);
  assert.match(app, /copyTarget\(e\.target\)/);
});
