// node --test tests/tg-fail.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { failLine, failHtml, openFix, fixPath } from '../web/tg-fail.js';

// A stand-in for the shell's WosModels: signedOutFail answers from a set of signed-out families, like WosUsage would.
const SUB = 'claude-subscription-directsdk-experimental';
const NAMES = { claude: ['wizard-claude', 'Claude'], chatgpt: ['wizard-chatgpt', 'ChatGPT'], tinfoil: ['wizard-tinfoil', 'Tinfoil'] };
function models(out = [], { reason = null, route = null, foreign = '' } = {}) {
  const fam = p => (p === SUB || p === 'claude' ? 'claude' : ['openai-codex', 'chatgpt'].includes(p) ? 'chatgpt' : p === 'tinfoil' ? 'tinfoil' : '');
  return {
    seen: [],
    signedOutFail(s) { this.seen.push(s.provider); const f = fam(s.provider); return !s.reconnect && (!s.runError || s.runError.code === 'provider_auth') && out.includes(f) ? { provider: f, appId: NAMES[f][0], name: NAMES[f][1] } : null; },
    runError: s => (reason && s.runError ? { code: s.runError.code, line: reason } : null),
    currentRoute: () => route,
    foreignApp: () => foreign,
  };
}
const failed = (extra = {}) => ({ id: 't', status: 'failed', model: 'claude-opus-4-7', provider: SUB, ...extra });

test('a send that failed on a signed-out Claude says so and offers Reconnect at the app\'s fix', () => {
  const l = failLine(failed(), models(['claude']));
  assert.deepEqual(l, { kind: 'signedout', text: 'Claude disconnected', button: 'Reconnect Claude', appId: 'wizard-claude', path: '/wizard-claude/?reconnect=1' });
  const h = failHtml(l);
  assert.match(h, /Claude disconnected<\/span> · <button[^>]*data-tg-reconnect="wizard-claude"[^>]*>Reconnect Claude<\/button>/);
  assert.equal((h.match(/<p /g) || []).length, 1, 'one line');
});

test('ChatGPT and Tinfoil open their own fixes; Tinfoil route ids count as the tinfoil family', () => {
  assert.equal(failLine(failed({ status: 'interrupted', model: 'gpt-5.5', provider: 'openai-codex' }), models(['chatgpt'])).path, '/wizard-chatgpt/?reconnect=1');
  for (const provider of ['custom:wizard-tinfoil', 'wizard-tinfoil', 'tinfoil']) {
    const M = models(['tinfoil']), l = failLine(failed({ model: 'kimi-k2', provider }), M);
    assert.equal(l.text, 'Tinfoil disconnected'); assert.equal(l.path, '/wizard-tinfoil/?connect=1'); assert.equal(M.seen[0], 'tinfoil');
  }
});

test('once the subscription reads signed in again, the line is the plain reason, without Reconnect', () => {
  const l = failLine(failed(), models([]));
  assert.equal(l.kind, 'reason'); assert.equal(l.button, undefined);
  assert.equal(l.text, 'Didn’t send · send it again');
  assert.doesNotMatch(failHtml(l), /button/);
  assert.equal(failLine(failed({ status: 'interrupted' }), models([])).text, 'Interrupted before it finished · send it again');
});

test('other failures keep one plain line: the shell\'s named reason when it has one', () => {
  const l = failLine(failed({ runError: { code: 'network' } }), models(['claude'], { reason: 'Couldn’t reach Claude: network problem' }));
  assert.deepEqual(l, { kind: 'reason', text: 'Couldn’t reach Claude: network problem' });
  assert.equal(failLine(failed({ source: 'telegram' }), models([], { foreign: 'Telegram' })).text, 'This chat started in Telegram · reply there');
});

test('an Agent Service sign-in expiry names the app and its sign-in', () => {
  const l = failLine(failed({ reconnect: { appId: 'wizard-claude', name: 'Claude', runId: 'r1' } }), models(['claude']));
  assert.equal(l.kind, 'expired'); assert.equal(l.text, 'Claude sign-in expired'); assert.equal(l.button, 'Sign in to Claude'); assert.equal(l.runId, 'r1');
});

test('nothing for a chat that is fine, still working, dismissed, or has no shell', () => {
  assert.equal(failLine({ id: 't', status: 'idle', provider: SUB }, models(['claude'])), null);
  assert.equal(failLine({ id: 't', status: 'running', provider: SUB }, models(['claude'])), null);
  assert.equal(failLine(failed(), models(['claude']), { dismissed: () => true }), null);
  assert.equal(failLine(null, models(['claude'])), null);
  assert.equal(failHtml(null), '');
  assert.equal(failLine(failed(), undefined).text, 'Didn’t send · send it again');
});

test('a thread without its own route uses the shell\'s current route for it', () => {
  const l = failLine({ id: 't', status: 'failed' }, models(['chatgpt'], { route: { model: 'gpt-5.5', provider: 'openai-codex' } }));
  assert.equal(l.appId, 'wizard-chatgpt');
});

test('Reconnect opens the app through the shell, a saved run goes to the Troubleshooter, else the page itself', () => {
  const calls = [], P = { WizOpenApp: (id, p) => { calls.push([id, p]); return true; } };
  openFix(P, 'wizard-claude', fixPath('wizard-claude'));
  openFix(P, 'wizard-chatgpt', fixPath('wizard-chatgpt'), 'run 7');
  assert.deepEqual(calls, [['wizard-claude', '/wizard-claude/?reconnect=1'], ['troubleshooter', '/troubleshoot/?provider=chatgpt&run_id=run%207']]);
  const went = []; openFix({ location: { assign: u => went.push(u) } }, 'wizard-tinfoil', fixPath('wizard-tinfoil'));
  assert.deepEqual(went, ['/wizard-tinfoil/?connect=1']);
});
