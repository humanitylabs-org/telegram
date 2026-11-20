// #22: skins (landscapes, obsidian) force `stroke: var(--ink-2) !important` on the attach icon, and --ink-2 is
// not defined in the TG frame, so the paperclip drew nothing. TG's own rule must be !important and more specific.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../web/styles.css', import.meta.url), 'utf8');

test('attach icon keeps TG grey stroke over skin !important rules', () => {
  const rule = css.split('\n').find(l => l.startsWith('.tg-view.tg-view .ch-compose .ch-attach svg {'));
  assert.ok(rule, 'TG attach svg rule exists');
  assert.match(rule, /stroke:\s*var\(--tg-sub,\s*#[0-9a-f]+\)\s*!important/i);
  assert.match(rule, /fill:\s*none\s*!important/);
});
