// node --test tests/tg-models.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModel, defaultRows, numberedLabel, behind, refreshPlan, REFRESH_MS } from '../web/tg-models.js';

const SUB = 'claude-subscription-directsdk-experimental';
const O = (value, provider) => ({ value, provider, name: value, description: provider });

test('ids parse to a numbered label; extra parts are variants', () => {
  assert.equal(numberedLabel('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(numberedLabel('anthropic/claude-opus-5.5'), 'Opus 5.5');
  assert.equal(numberedLabel('glm-5-3'), 'GLM 5.3');
  assert.equal(numberedLabel('z-ai/glm-5.3'), 'GLM 5.3');
  assert.equal(numberedLabel('deepseek-v4-1'), 'DeepSeek V4.1');
  assert.equal(numberedLabel('deepseek/deepseek-v4.1'), 'DeepSeek V4.1');
  assert.equal(numberedLabel('claude-fable-5-2'), 'Fable 5.2');
  assert.equal(numberedLabel('gpt-6.1-sol'), 'Sol 6.1');
  assert.equal(numberedLabel('gpt-6-sol'), 'Sol 6');
  assert.equal(numberedLabel('kimi-k3'), '');
  assert.equal(numberedLabel('claude-sonnet-5'), '');
  for (const v of ['claude-opus-5-5[1m]', 'claude-opus-5-5-20261001', 'glm-5-3-flashx', 'glm-4.5-air', 'gpt-6-sol-900k', 'deepseek-v4-1-pro', 'claude-opus-5-5-fast'])
    assert.equal(parseModel(v).variant, true, v);
  assert.equal(parseModel('claude-opus-5-5').variant, false);
});

test('five rows in order, newest version, preferred route, variants skipped', () => {
  const opts = [
    O('gpt-6-sol', 'openai-codex'), O('gpt-6.1-sol', 'openai-codex'), O('gpt-6.1-sol-900k', 'openai-codex'),
    O('claude-fable-5-2', 'anthropic'), O('claude-fable-5-2', SUB), O('claude-fable-5-1', SUB),
    O('deepseek/deepseek-v4.1', 'nous'), O('deepseek-v4-1', 'custom:wizard-tinfoil'), O('deepseek-v3-2', 'custom:wizard-tinfoil'),
    O('glm-5-3-flashx', 'custom:wizard-tinfoil'), O('glm-5-3', 'custom:wizard-tinfoil'), O('glm-6-0-air', 'nous'),
    O('claude-opus-5-5[1m]', SUB), O('claude-opus-5-5', SUB), O('claude-opus-5-1', SUB), O('claude-sonnet-5', SUB), O('kimi-k3', 'custom:wizard-tinfoil'),
  ];
  const rows = defaultRows(opts, { model: 'claude-opus-5-5', provider: SUB });
  assert.deepEqual(rows.map(r => [r.label, r.value, r.provider]), [
    ['Opus 5.5', 'claude-opus-5-5', SUB],
    ['GLM 5.3', 'glm-5-3', 'custom:wizard-tinfoil'],
    ['DeepSeek V4.1', 'deepseek-v4-1', 'custom:wizard-tinfoil'],
    ['Fable 5.2', 'claude-fable-5-2', SUB],
    ['Sol 6.1', 'gpt-6.1-sol', 'openai-codex'],
  ]);
});

test('a missing family is left out; the current model on top when it is not one of the rows', () => {
  const opts = [O('claude-opus-5-5', SUB), O('claude-opus-5-1', SUB), O('kimi-k3', 'custom:wizard-tinfoil')];
  assert.deepEqual(defaultRows(opts, null).map(r => r.label), ['Opus 5.5']);
  assert.deepEqual(defaultRows(opts, { model: 'kimi-k3', provider: 'custom:wizard-tinfoil' }).map(r => r.label), ['kimi-k3', 'Opus 5.5']);
  assert.deepEqual(defaultRows(opts, { model: 'claude-opus-5-1', provider: SUB }).map(r => r.label), ['Opus 5.1', 'Opus 5.5']);
});

test('a variant is used when it is the only route for its family', () => {
  assert.deepEqual(defaultRows([O('glm-5-3-flashx', 'nous')], null).map(r => [r.label, r.value]), [['GLM 5.3', 'glm-5-3-flashx']]);
});

// telegram#40: Hermes' cached anthropic list lacked claude-fable-5-2 while chats already ran on it.
const STALE = [O('claude-fable-5.1', 'anthropic'), O('claude-fable-5', 'anthropic'), O('claude-opus-5-5', 'anthropic')];
const FRESH = [O('claude-fable-5-2', 'anthropic'), ...STALE];

test('a thread on a Fable newer than the stale list shows it as the checked Fable row', () => {
  const cur = { model: 'claude-fable-5-2', provider: 'anthropic' };
  const rows = defaultRows(STALE, cur);
  assert.deepEqual(rows.map(r => [r.label, r.value, r.provider]), [['Opus 5.5', 'claude-opus-5-5', 'anthropic'], ['Fable 5.2', 'claude-fable-5-2', 'anthropic']]);
  assert.equal(rows[1].description, 'anthropic');
  assert.equal(numberedLabel(cur.model), 'Fable 5.2');
  assert.deepEqual(defaultRows(FRESH, cur).map(r => [r.label, r.value]), [['Opus 5.5', 'claude-opus-5-5'], ['Fable 5.2', 'claude-fable-5-2']]);
});

test('a new chat gets Fable 5.2 once the refreshed list arrives', () => {
  assert.deepEqual(defaultRows(STALE, null).map(r => r.label), ['Opus 5.5', 'Fable 5.1']);
  assert.deepEqual(defaultRows(FRESH, null).map(r => [r.label, r.value]), [['Opus 5.5', 'claude-opus-5-5'], ['Fable 5.2', 'claude-fable-5-2']]);
});

test('a thread on an older Fable still offers the newest Fable row', () => {
  const rows = defaultRows(FRESH, { model: 'claude-fable-5.1', provider: 'anthropic' });
  assert.deepEqual(rows.map(r => [r.label, r.value]), [['Fable 5.1', 'claude-fable-5.1'], ['Opus 5.5', 'claude-opus-5-5'], ['Fable 5.2', 'claude-fable-5-2']]);
});

test('behind names models chats run that are newer than the list', () => {
  const seen = [{ model: 'claude-fable-5-2', provider: 'anthropic' }, { model: 'claude-opus-5-5' }, { model: 'kimi-k3' }, { model: 'claude-fable-5-2' }];
  assert.deepEqual(behind(STALE, seen), ['Fable 5.2']);
  assert.deepEqual(behind(FRESH, seen), []);
  assert.deepEqual(behind(STALE, [{ model: 'glm-5-3' }]), ['GLM 5.3']);
  assert.deepEqual(behind(STALE, [{ model: 'claude-fable-6-0-fast' }]), []);
});

test('refresh at most once an hour, and once more for each new model the list is behind on', () => {
  const now = 10 * REFRESH_MS, fable = [{ model: 'claude-fable-5-2' }];
  assert.deepEqual(refreshPlan(STALE, [], null, now), { at: now, sig: '' });
  assert.equal(refreshPlan(STALE, [], { at: now - 1000, sig: '' }, now), null);
  assert.deepEqual(refreshPlan(STALE, [], { at: now - REFRESH_MS, sig: '' }, now), { at: now, sig: '' });
  assert.deepEqual(refreshPlan(STALE, fable, { at: now - 1000, sig: '' }, now), { at: now, sig: 'Fable 5.2' });
  assert.equal(refreshPlan(STALE, fable, { at: now - 1000, sig: 'Fable 5.2' }, now), null);
  assert.equal(refreshPlan(FRESH, fable, { at: now - 1000, sig: '' }, now), null);
  assert.deepEqual(refreshPlan(STALE, [], { at: now + 5000, sig: '' }, now), { at: now, sig: '' });
});
