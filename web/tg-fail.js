// The one line at the bottom of a failed or interrupted chat (telegram#53): why it didn't send, and for a signed-out
// subscription a button that opens its connection app straight at its fix. The decision is the shell's own
// (WosModels.signedOutFail / runError, the same rule as the built-in Chats card); this only turns it into one line.

const FAILED = new Set(['failed', 'interrupted']);
// Where each connection app repairs a sign-in (the built-in's openReconnect paths).
const FIX = { 'wizard-claude': '/wizard-claude/?reconnect=1', 'wizard-chatgpt': '/wizard-chatgpt/?reconnect=1', 'wizard-tinfoil': '/wizard-tinfoil/?connect=1' };
// Tinfoil threads run on a custom Hermes route; WosModels.signedOutFor only knows the family name 'tinfoil'.
const TINFOIL = new Set(['tinfoil', 'wizard-tinfoil', 'custom:wizard-tinfoil', 'custom:tinfoil-operator']);

export const fixPath = appId => FIX[appId] || `/${appId}/`;

/** The thread's route: its own model and provider, else the shell's current route for it. */
function routeOf(s, M) {
  if (s.model || s.provider) return { model: s.model || '', provider: s.provider || '' };
  try { return M?.currentRoute?.(s.id) || { model: '', provider: '' }; } catch (_) { return { model: '', provider: '' }; }
}

/**
 * @param s  the chat's WizLive session row
 * @param M  the shell's WosModels (window.parent), may be missing
 * @param E  the shell's WosErrors (dismissed failures show nothing, like the built-in), may be missing
 * @returns null, or { kind: 'signedout' | 'expired' | 'reason', text, button?, appId?, path?, runId? }
 */
export function failLine(s, M, E) {
  if (!s || !FAILED.has(s.status)) return null;
  try { if (E?.dismissed?.(s)) return null; } catch (_) {}
  try { const app = M?.foreignApp?.(s); if (app) return { kind: 'reason', text: `This chat started in ${app} · reply there` }; } catch (_) {}
  const route = routeOf(s, M);
  const provider = TINFOIL.has(String(route.provider || '').toLowerCase()) ? 'tinfoil' : route.provider;
  let out = null;
  try { out = M?.signedOutFail?.({ ...s, ...route, provider }) || null; } catch (_) {}
  if (out?.appId) return { kind: 'signedout', text: `${out.name} disconnected`, button: `Reconnect ${out.name}`, appId: out.appId, path: fixPath(out.appId) };
  const rc = s.reconnect;
  if (rc?.appId && s.queueReason !== 'provider_access') {
    const name = rc.name || 'your AI';
    return { kind: 'expired', text: `${name} sign-in expired`, button: `Sign in to ${name}`, appId: rc.appId, path: fixPath(rc.appId), runId: rc.runId || '' };
  }
  let re = null;
  try { re = M?.runError?.(s) || null; } catch (_) {}
  if (re?.line) return { kind: 'reason', text: re.line };
  return { kind: 'reason', text: s.status === 'interrupted' ? 'Interrupted before it finished · send it again' : 'Didn’t send · send it again' };
}

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** One line: "Claude disconnected · [Reconnect Claude]". */
export function failHtml(line) {
  if (!line) return '';
  const btn = line.button ? ` · <button type="button" class="tg-fail-fix" data-tg-reconnect="${esc(line.appId)}" data-tg-fix-path="${esc(line.path)}" data-tg-fix-run="${esc(line.runId || '')}">${esc(line.button)}</button>` : '';
  return `<p class="tg-fail" role="status" data-tg-fail="${esc(line.kind)}"><span>${esc(line.text)}</span>${btn}</p>`;
}

/**
 * Open the connection app at its fix, the way the built-in does: a saved run of a Claude or ChatGPT sign-in expiry
 * goes to the Troubleshooter (it resumes the run); otherwise the app opens at its Reconnect (Tinfoil: Connect) step.
 * @param P the parent window (the shell)
 */
export function openFix(P, appId, path, runId = '') {
  const prov = appId === 'wizard-claude' ? 'claude' : appId === 'wizard-chatgpt' ? 'chatgpt' : '';
  if (runId && prov) {
    const t = `/troubleshoot/?provider=${prov}&run_id=${encodeURIComponent(runId)}`;
    if (P?.WizOpenApp?.('troubleshooter', t)) return true;
  }
  if (P?.WizOpenApp?.(appId, path)) return true;
  try { (P || window).location.assign(path); return true; } catch (_) { return false; }
}
