// Numbered model defaults (switch numbered-models, telegram#13). The model menu's default rows are exactly five
// families in this order: Opus, GLM, DeepSeek, Fable, Sol. Each row is the newest version this box offers, labelled
// with its number ("Opus 5.5", "GLM 5.3", "DeepSeek V4.1"). Pure functions over WosModels.options so they can be
// tested without the shell.

export const FAMILIES = ['opus', 'glm', 'deepseek', 'fable', 'sol'];
const NAMES = { opus: 'Opus', glm: 'GLM', deepseek: 'DeepSeek', fable: 'Fable', sol: 'Sol' };
const SUB = 'claude-subscription-directsdk-experimental';
const isTinfoil = p => p === 'wizard-tinfoil' || p === 'custom:wizard-tinfoil' || p === 'tinfoil';
const isNous = p => /^(custom:)?nous/i.test(p || '');

// Which route wins when one version is on several providers: the subscription or private route first, then Nous.
function routeRank(family, provider) {
  const p = provider || '';
  if (family === 'opus' || family === 'fable') return p === SUB ? 0 : p === 'anthropic' ? 1 : isNous(p) ? 2 : 3;
  if (family === 'glm' || family === 'deepseek') return isTinfoil(p) ? 0 : isNous(p) ? 1 : 2;
  if (family === 'sol') return p === 'openai-codex' ? 0 : isNous(p) ? 1 : 2;
  return 9;
}

/* Parse a model id into { family, version: [n...], label, variant }. Accepts provider-prefixed ids
 * (anthropic/claude-opus-5.5), dashed or dotted versions (glm-5-3, glm-5.3), DeepSeek's V numbers (deepseek-v4-1)
 * and GPT tiers (gpt-6.1-sol). Anything after the version (pro, fast, flex, flashx, air, 900k, [1m] context, a dated
 * snapshot) marks it a variant. Returns null for other families or ids without a version. */
export function parseModel(id) {
  let s = String(id || '').toLowerCase().trim();
  let variant = false;
  if (/\[.*\]$/.test(s)) { variant = true; s = s.replace(/\[.*$/, ''); }
  s = s.slice(s.lastIndexOf('/') + 1);
  const toks = s.split(/[-_:]/).filter(Boolean).flatMap(t => /^v?\d+(\.\d+)+$/.test(t) ? splitDots(t) : [t]);
  let family = '', ver = [], rest = [];
  const gpt = toks[0] === 'gpt' ? toks.indexOf('sol') : -1;
  if (gpt > 0) {
    family = 'sol';
    ver = toks.slice(1, gpt).filter(t => /^\d{1,2}$/.test(t)).map(Number);
    if (ver.length !== gpt - 1) return null;
    rest = toks.slice(gpt + 1);
  } else {
    const at = toks.findIndex(t => FAMILIES.includes(t) && t !== 'sol' || /^deepseek$/.test(t));
    if (at < 0) return null;
    family = toks[at];
    if ((family === 'opus' || family === 'fable') && at > 0 && toks[0] !== 'claude') return null;
    let k = at + 1;
    if (family === 'deepseek') {
      const m = /^v(\d+)$/.exec(toks[k] || '');
      if (!m) return null;
      ver.push(Number(m[1])); k++;
    }
    while (k < toks.length && /^\d{1,2}$/.test(toks[k])) ver.push(Number(toks[k++]));
    if (!ver.length) return null;
    rest = toks.slice(k);
  }
  if (rest.length) variant = true;
  const num = ver.join('.');
  return { family, version: ver, variant, label: `${NAMES[family]} ${family === 'deepseek' ? 'V' + num : num}` };
}
function splitDots(t) { const v = t.startsWith('v'); const p = t.replace(/^v/, '').split('.'); if (v) p[0] = 'v' + p[0]; return p; }

const cmpVer = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d) return d; } return 0; };

// Newest version per family in a list of routes: plain route before variants, preferred provider on a tie.
function bestByFamily(options) {
  const best = new Map();
  for (const o of options || []) {
    const m = parseModel(o?.value); if (!m) continue;
    const p = best.get(m.family);
    const better = !p
      || (p.m.variant !== m.variant ? !m.variant
        : cmpVer(m.version, p.m.version) ? cmpVer(m.version, p.m.version) > 0
          : routeRank(m.family, o.provider) < routeRank(m.family, p.o.provider));
    if (better) best.set(m.family, { o, m });
  }
  return best;
}

/* The menu's default rows: one per family in FAMILIES order, newest version, plain route before variants, preferred
 * provider on a tie. A family missing on the box is left out. The current route, when it is newer than its family's
 * row (a stale catalogue, telegram#40), is that family's row; otherwise, when it is not one of the rows, it goes on
 * top. Each row is the option plus label (the numbered name). */
export function defaultRows(options, cur) {
  const best = bestByFamily(options);
  let curRow = null;
  if (cur?.model) {
    const isCur = o => o.value === cur.model && (!cur.provider || o.provider === cur.provider);
    const sameRoute = (options || []).find(o => o.provider === cur.provider);
    const o = (options || []).find(isCur) || { value: cur.model, provider: cur.provider || '', name: cur.model, description: sameRoute?.description || '' };
    const m = parseModel(o.value), b = m && best.get(m.family);
    if (m && !m.variant && (!b || b.m.variant || cmpVer(m.version, b.m.version) > 0)) best.set(m.family, { o, m });
    else curRow = { o, isCur };
  }
  const rows = FAMILIES.filter(f => best.has(f)).map(f => ({ ...best.get(f).o, label: best.get(f).m.label }));
  if (curRow && !rows.some(curRow.isCur)) rows.unshift({ ...curRow.o, label: numberedLabel(curRow.o.value) || curRow.o.name || curRow.o.value });
  return rows;
}

/* Fresh catalogue (telegram#40). Hermes serves the model list from a per-provider disk cache, so a new version (Fable
 * 5.2) can be missing from the menu while chats already run on it. `behind` names the models the box is known to run
 * (the current route, recent chats) that are newer than their family's newest entry in the list. `refreshPlan` says
 * whether to ask Hermes for a refreshed list now: at most once an hour, and once more for each new set of models the
 * list is behind on. Returns the state to save, or null when the list is fresh enough. */
export const REFRESH_MS = 60 * 60e3;
export function behind(options, seen) {
  const best = bestByFamily(options), out = new Set();
  for (const r of seen || []) {
    const m = parseModel(r?.model); if (!m || m.variant) continue;
    const b = best.get(m.family);
    if (!b || cmpVer(m.version, b.m.version) > 0) out.add(m.label);
  }
  return [...out].sort();
}
export function refreshPlan(options, seen, state, now) {
  const sig = behind(options, seen).join(',');
  const at = Number(state?.at) || 0;
  if (!at || now - at >= REFRESH_MS || now < at) return { at: now, sig };
  if (sig && sig !== (state?.sig || '')) return { at: now, sig };
  return null;
}

// "Opus 5.5" for the header pill; '' when the id is not one we can number (the caller keeps its old label).
export function numberedLabel(model) { return parseModel(model)?.label || ''; }
