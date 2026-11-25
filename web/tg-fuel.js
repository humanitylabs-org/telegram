// telegram#54: the AI apps sidebar's fuel gauge (E ▮▮▮ F) at the foot of the chat list.
// Nothing is redrawn here. The shell's own component paints it: wizard-ux web/layouts/ai-apps/parts.js gaugeInto,
// fuelOf and fuelEl, loaded from the shell (same origin), read from the shell's AI usage feed (WosResources, kept
// polling while the gauge is on screen) with the default model's provider, exactly as the desktop sidebar foot does.
// A tap opens the same page the sidebar gauge opens (Settings › AI with the network Home's live gauge, else AI usage)
// through the shell's in-app link route (WizCore.deeplink), the route both shells register for ?view=<page>.

const REPAINT_MS = 2000;

/** The shell's parts.js URL, next to the shell page itself (…/wizard-os-home/layouts/ai-apps/parts.js). */
export function partsUrl(P) {
  try { return new URL('layouts/ai-apps/parts.js', P.document.baseURI).href; } catch (_) { return '/wizard-os-home/layouts/ai-apps/parts.js'; }
}

/** The in-app link for a Settings page on the shell page (?view=ai / ?view=usage). */
export function viewHref(P, page) {
  return new URL('?view=' + encodeURIComponent(page), P.location.href).href;
}

/**
 * fuelHost(P, doc) -> { mount(box) } or null without a shell.
 * P = the shell window (window.parent), doc = this page's document. importer is swappable for tests.
 */
export function fuelHost(P, doc, { importer = u => import(u), every = REPAINT_MS, timers = globalThis } = {}) {
  if (!P || !doc) return null;
  let parts = null, loading = null;
  const load = () => loading || (loading = Promise.resolve().then(() => importer(partsUrl(P))).then(m => {
    if (typeof m?.gaugeInto === 'function' && typeof m?.fuelOf === 'function') parts = m;
    return parts;
  }, e => { console.warn('TG fuel gauge: the shell has no AI fuel gauge', e); return null; }));
  // The live network Home gauge, when there is one, lives on the shell page; the copy is built in this page.
  const scope = { querySelectorAll: s => { try { return P.document.querySelectorAll(s); } catch (_) { return []; } }, createElement: t => doc.createElement(t) };
  const own = () => {
    let state = {}, provider = '';
    try { const r = P.WosResources?.state || {}; state = { ai: r.ai || null, aiError: r.aiError || '' }; } catch (_) {}
    try { provider = String(P.WosModels?.defaultOption?.()?.provider || ''); } catch (_) {}
    return parts.fuelOf(state, provider);
  };
  const open = page => {
    const pg = page || 'ai';
    try { return P.WizCore?.deeplink?.route?.(viewHref(P, pg)) === true; } catch (e) { console.warn('TG fuel gauge: could not open', pg, e); return false; }
  };
  return {
    /** Paint the gauge into box and keep it current while box stays in the page. Returns a stop function. */
    mount(box) {
      let sig = '', timer = null;
      const paint = () => {
        if (!box.isConnected) { stop(); return; }
        if (!parts) return;
        try { sig = parts.gaugeInto(scope, box, sig, open, own); } catch (e) { console.warn('TG fuel gauge', e); }
      };
      const stop = () => { if (timer) timers.clearInterval(timer); timer = null; };
      box.hidden = true;
      try { P.WosResources?.watch?.(box); } catch (_) {}
      if (parts) paint(); else load().then(paint);
      timer = timers.setInterval(paint, every);
      return stop;
    },
    open,
  };
}
