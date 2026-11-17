// Telegram as a normal app window. The chat list is tg-view.js; threads, sending, uploads, voice, live replies and
// approvals all go through the shell's own engine on the parent page (same origin), so this page keeps no
// messages, tokens or model logic of its own.
import view, { cleanTitle } from './tg-view.js';

const root = document.getElementById('tg-root');
const P = (() => { try { return window.parent !== window && window.parent.WizLive ? window.parent : null; } catch (_) { return null; } })();
const LIVE = P?.WizLive, KIT = P?.WosChat;
const WORKING = new Set(['submitting', 'queued', 'running', 'stopping']);
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

if (!LIVE) root.innerHTML = '<div class="tg-off"><b>Open Telegram from Wizard</b><p>This window shows your Wizard chats, so it needs to be opened inside Wizard on this box.</p></div>';
else start();

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function clock(ts) { const d = new Date(typeof ts === 'number' ? ts * 1000 : ts); return isFinite(d) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''; }
function day(ts) {
  const d = new Date(typeof ts === 'number' ? ts * 1000 : ts), now = new Date();
  if (!isFinite(d)) return '';
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === new Date(now - 864e5).toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'long', day: 'numeric' });
}
function fmtTime(ms) { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function textOf(c) { return Array.isArray(c) ? c.map(p => typeof p === 'string' ? p : p?.text || '').join('') : String(c || ''); }

// Owner files ride as [WIZARD_FILES_V1]/[WIZARD_FILE_CHIPS_V1]; agent files as the helm envelope. Both become chips.
function filesIn(raw) {
  const out = [];
  for (const m of raw.matchAll(/\[WIZARD_FILES_V1\]\s*([\s\S]*?)\s*\[\/WIZARD_FILES_V1\]/g)) {
    try { for (const f of JSON.parse(m[1])) if (SAFE_ID.test(String(f?.id || ''))) out.push({ id: f.id, name: f.filename || f.name || 'file', mime: f.mime || '', url: `/wizard/files/${encodeURIComponent(f.id)}/content` }); } catch (_) {}
  }
  for (const f of KIT?.chipFiles?.(raw) || []) if (f.id && !out.some(x => x.id === f.id)) out.push({ ...f, url: `/wizard/files/${encodeURIComponent(f.id)}/content` });
  return out;
}
function strip(s) {
  return String(s || '')
    .replace(/\[WIZARD_FILES_V1\][\s\S]*?\[\/WIZARD_FILES_V1\]/g, '').replace(/\[WIZARD_FILE_CHIPS_V1\][\s\S]*?\[\/WIZARD_FILE_CHIPS_V1\]/g, '')
    .replace(/\[WIZARD_[A-Z0-9_]+_V1\][\s\S]*?\[\/WIZARD_[A-Z0-9_]+_V1\]/g, '')
    .replace(/<memory-context>[\s\S]*?<\/memory-context>/g, '').replace(/^\[Workspace::v1: [^\]\r\n]+\]\s*/, '')
    .replace(/^\s*\[OUT-OF-BAND USER MESSAGE[^\]\n]*\]\s*/, '').replace(/\s*\[\/OUT-OF-BAND USER MESSAGE\]\s*$/, '')
    .trim();
}
function shape(m) {
  const raw = textOf(m.content);
  if (m.role === 'user') return { ...m, text: strip(raw), files: filesIn(raw) };
  let h = { text: raw, attachments: [] };
  try { if (KIT?.helm) h = KIT.helm(raw); } catch (_) {}
  const inline = new Set(Object.values(h.inlineMedia || {}));
  return { ...m, text: strip(h.text), ask: typeof m.wizard_ask === 'string' && m.wizard_ask.trim() ? m.wizard_ask.replace(/\s+/g, ' ').trim().slice(0, 400) : askOf(raw), files: (h.attachments || []).filter(a => !inline.has(a.url)) };
}
// The reply's own short answer: the plain-words ask from its status line (the same words the chat list shows).
function askOf(raw) {
  const m = String(raw).match(/\[WIZARD_STATUS_V1\]\s*([\s\S]*?)\s*\[\/WIZARD_STATUS_V1\]/);
  try { const a = m && JSON.parse(m[1]); return typeof a?.ask === 'string' ? a.ask.replace(/\s+/g, ' ').trim().slice(0, 400) : ''; } catch (_) { return ''; }
}
function md(text) {
  try { if (KIT?.md) return KIT.md(text); } catch (_) {}
  return esc(text).replace(/\n/g, '<br>');
}
// Image lines (the helm's inline images and any same-origin Markdown image) become real pictures, not links.
const IMG_LINE = /^[ \t]*!\[([^\]\n]*)\]\(\s*<?(\/(?![\/\\])[^\s)>]+)>?(?:\s+"[^"]*")?\s*\)[ \t]*$/;
function rich(text) {
  let out = '', buf = [];
  const flush = () => { if (buf.length) { out += md(buf.join('\n')); buf = []; } };
  for (const line of String(text).split('\n')) {
    const m = line.match(IMG_LINE);
    if (m) { flush(); out += `<a class="tg-img" href="${esc(m[2])}" target="_blank" rel="noopener"><img src="${esc(m[2])}" alt="${esc(m[1] || 'Image')}" loading="lazy"></a>`; }
    else buf.push(line);
  }
  flush(); return out;
}
/* Voice messages: play button, progress bar and length, like Telegram. Recorded webm has no length in its header,
   so the length comes from probing the end once, then it is remembered on this device. */
const VDUR_KEY = 'tg.voice-durations.v1';
const VDUR = (() => { try { return JSON.parse(localStorage.getItem(VDUR_KEY) || '{}'); } catch (_) { return {}; } })();
const mmss = s => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const vnotes = url => document.querySelectorAll(`[data-tg-vnote="${CSS.escape(url)}"]`);
const vProbing = new Set();
function voiceLength(url) {
  if (!url || VDUR[url] || vProbing.has(url)) return; vProbing.add(url);
  const a = new Audio(); a.preload = 'metadata';
  const done = d => {
    vProbing.delete(url); a.removeAttribute('src'); a.load();
    if (!(isFinite(d) && d > 0)) { for (const n of vnotes(url)) n.querySelector('.tg-vd').textContent = ''; return; }
    VDUR[url] = d; try { localStorage.setItem(VDUR_KEY, JSON.stringify(VDUR)); } catch (_) {}
    for (const n of vnotes(url)) if (!n.classList.contains('playing')) n.querySelector('.tg-vd').textContent = mmss(d);
  };
  a.addEventListener('loadedmetadata', () => {
    if (isFinite(a.duration) && a.duration > 0) return done(a.duration);
    a.addEventListener('durationchange', function f() { if (isFinite(a.duration) && a.duration > 0) { a.removeEventListener('durationchange', f); done(a.duration); } });
    a.currentTime = 1e7;
  });
  a.addEventListener('error', () => done(0));
  setTimeout(() => { if (vProbing.has(url)) done(0); }, 15000);
  a.src = url;
}
let vPlayer = null; // { url, audio }
function paintVoice(url, playing, frac, t) {
  for (const n of vnotes(url)) {
    n.classList.toggle('playing', !!playing);
    if (frac != null) n.style.setProperty('--p', String(Math.max(0, Math.min(1, frac))));
    const vd = n.querySelector('.tg-vd'); if (playing && t != null) vd.textContent = mmss(t); else if (!playing && VDUR[url]) vd.textContent = mmss(VDUR[url]);
  }
}
function toggleVoice(url, onErr) {
  if (vPlayer && vPlayer.url === url) { if (vPlayer.audio.paused) vPlayer.audio.play().catch(() => {}); else vPlayer.audio.pause(); return; }
  if (vPlayer) { vPlayer.audio.pause(); paintVoice(vPlayer.url, false, 0); }
  const audio = new Audio(url); vPlayer = { url, audio };
  paintVoice(url, true, 0, 0);
  audio.addEventListener('timeupdate', () => { const d = VDUR[url] || audio.duration; paintVoice(url, !audio.paused, isFinite(d) && d ? audio.currentTime / d : 0, audio.currentTime); });
  audio.addEventListener('pause', () => paintVoice(url, false));
  audio.addEventListener('ended', () => { if (!VDUR[url] && audio.currentTime > 0) { VDUR[url] = audio.currentTime; try { localStorage.setItem(VDUR_KEY, JSON.stringify(VDUR)); } catch (_) {} } paintVoice(url, false, 0); vPlayer = null; });
  audio.addEventListener('error', () => { paintVoice(url, false, 0); vPlayer = null; onErr?.('Couldn’t play this voice message'); });
  audio.play().catch(e => { if (e?.name !== 'AbortError') { paintVoice(url, false, 0); vPlayer = null; onErr?.('Couldn’t play this voice message'); } });
}
/* Transcripts under voice messages: the Transcriber app (on this box) hears each one once; the app keeps the words. */
const TX_KEY = 'tg.voice-transcripts.v1';
const TX = (() => { try { return JSON.parse(localStorage.getItem(TX_KEY) || '{}'); } catch (_) { return {}; } })();
const txWaiting = [], txState = {};
function txHtml(url) {
  const t = TX[url];
  if (typeof t === 'string') return t ? `<div class="tg-vtx" data-tg-vtx="${esc(url)}">${esc(t)}</div>` : '';
  if (txState[url] === 'failed') return `<div class="tg-vtx off" data-tg-vtx="${esc(url)}"><button type="button" data-tg-vtx-retry="${esc(url)}">Show words</button></div>`;
  wantWords(url);
  return `<div class="tg-vtx wait" data-tg-vtx="${esc(url)}">Listening…</div>`;
}
function paintWords(url) { for (const n of document.querySelectorAll(`[data-tg-vtx="${CSS.escape(url)}"]`)) n.outerHTML = txHtml(url); }
function wantWords(url) { if (!url || txState[url] || typeof TX[url] === 'string') return; txState[url] = 'queued'; txWaiting.push(url); setTimeout(txPump, 0); }
let txBusy = false;
async function txPump() {
  if (txBusy || !txWaiting.length) return; txBusy = true;
  try {
    // Words another device already got are on the app's server.
    const ask = txWaiting.filter(u => txState[u] === 'queued').slice(0, 40);
    if (ask.length) try {
      const r = await fetch(`api/transcripts?keys=${encodeURIComponent(JSON.stringify(ask))}`, { credentials: 'same-origin', cache: 'no-store' });
      const got = r.ok ? (await r.json()).transcripts || {} : {};
      for (const u of ask) { txState[u] = 'checked'; if (typeof got[u] === 'string') { TX[u] = got[u]; saveTx(); paintWords(u); } }
    } catch (_) { for (const u of ask) txState[u] = 'checked'; }
    const url = txWaiting.shift(); if (!url || typeof TX[url] === 'string') return;
    try {
      const audio = await fetch(url, { credentials: 'same-origin' });
      if (!audio.ok) throw new Error('audio');
      const blob = await audio.blob();
      const r = await fetch(`api/transcribe?key=${encodeURIComponent(url)}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob });
      if (!r.ok) throw new Error('transcribe');
      TX[url] = String((await r.json()).text || '').trim(); saveTx(); txState[url] = 'done';
    } catch (_) { txState[url] = 'failed'; }
    paintWords(url);
  } finally { txBusy = false; if (txWaiting.length) setTimeout(txPump, 0); }
}
function saveTx() { try { const k = Object.keys(TX); if (k.length > 600) for (const x of k.slice(0, k.length - 600)) delete TX[x]; localStorage.setItem(TX_KEY, JSON.stringify(TX)); } catch (_) {} }
function retryWords(url) { delete txState[url]; delete TX[url]; paintWords(url); }
function fileHtml(f) {
  const mime = String(f.mime || '');
  if (mime.startsWith('image/')) return `<a class="tg-img" href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" alt="${esc(f.name)}" loading="lazy"></a>`;
  if (mime.startsWith('audio/') || /^wizard-voice-/.test(f.name || '')) { voiceLength(f.url); const d = VDUR[f.url]; return `<button type="button" class="tg-vnote" data-tg-vnote="${esc(f.url)}" aria-label="Play voice message"><span class="tg-vp"><svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg><i></i></span><span class="tg-vw"><span class="tg-vbar"><b></b></span><span class="tg-vd">${d ? mmss(d) : '…'}</span></span></button>${txHtml(f.url)}`; }
  return `<a class="tg-file" href="${esc(f.url)}" target="_blank" rel="noopener"><i>📄</i><span>${esc(f.name)}</span></a>`;
}

// What the chat is about, from its title (then subject): a small fixed list, first match wins.
function topics() { return [
  [/telegram/, '📨'], [/messenger|whatsapp|\bline\b|chat/, '💬'], [/mail|inbox|email/, '✉️'],
  [/notes?\b|obsidian|wisdom/, '📝'], [/calendar|schedul|meeting/, '📅'], [/vespa|scooter|motorbike|mechanic/, '🛵'],
  [/car\b|car-rental|rental|drive/, '🚗'], [/apartment|condo|house|rent\b|viewing|home\b/, '🏢'],
  [/visa|passport|immigration|embassy/, '🛂'], [/trip|travel|flight|tokyo|japan/, '✈️'],
  [/money|bank|budget|finance|card|tax|invoice|pay/, '💰'], [/health|whoop|oura|sleep|garmin|fitbit|workout|gym/, '❤️'],
  [/music|spotify|playlist/, '🎵'], [/podcast/, '🎙️'], [/video|defleur|movie|film|youtube/, '🎬'],
  [/news/, '📰'], [/backup|storage|disk/, '💾'], [/wingman|student|course|academy|teach/, '🎓'],
  [/sniper|kakao|scan/, '🎯'], [/marketplace|second.?hand|sell|buy|shop|lazada|grab/, '🛍️'],
  [/food|usuals|restaurant|meal/, '🍜'], [/smart home|home assistant|lights?\b/, '💡'],
  [/contact|crm|carlos|client|customer/, '👥'], [/tracker|board|builder|pipeline|release/, '📋'],
  [/phone|android|iphone|pixel/, '📱'], [/voice|transcri|dictation/, '🎤'], [/search|research/, '🔎'],
  [/browser|web\b|website|cloudflare|domain/, '🌐'], [/security|secret|password|key\b/, '🔐'],
  [/wizard|desktop|app\b|apps\b|skin|look/, '🧙'],
]; }
function topicEmoji(s) {
  for (const src of [s?.title, s?.attention?.subject]) {
    const t = String(src || '').toLowerCase(); if (!t) continue;
    for (const [re, e] of topics()) if (re.test(t)) return e;
  }
  return '';
}

function makeNotes() {
  let items = [], busy = false; const subs = new Set();
  const emit = () => { for (const fn of [...subs]) { try { fn(items); } catch (e) { console.error(e); } } };
  // Only what Settings > Notifications sends to Chats: Badge, Morning report and Off sources stay out, as in Chats.
  const inChats = it => { const B = P?.WosBell; try { return !B?.route || !B?.routeIdOf || B.route(B.routeIdOf(it)) === 'chats'; } catch (_) { return true; } };
  async function refresh() {
    if (busy) return; busy = true;
    try {
      const r = await fetch('/notifications/api/items?view=inbox&limit=100', { cache: 'no-store', credentials: 'same-origin' });
      if (r.ok) { const d = await r.json(); if (Array.isArray(d?.items)) { const next = d.items.filter(i => i && i.id && !i.archived && inChats(i)); if (JSON.stringify(next) !== JSON.stringify(items)) { items = next; emit(); } } }
    } catch (_) {} finally { busy = false; }
  }
  async function mark(id) {
    items = items.map(i => i.id === id ? { ...i, read: true } : i); emit();
    try { await fetch('/notifications/api/mark', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id], read: true }) }); } catch (_) {}
    try { P?.WosBell?.refresh?.(true); } catch (_) {}
    refresh();
  }
  if (P) { refresh(); setInterval(refresh, 30000); addEventListener('focus', refresh); document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); }); }
  return {
    items: () => items,
    watch: fn => { subs.add(fn); refresh(); return () => subs.delete(fn); },
    item: id => items.find(i => i.id === id) || null,
    read: id => mark(id),
    opener: null,
    open(id) { this.opener?.(id); },
    // Done: archive it in Notifications, so it leaves every list.
    async done(id) {
      items = items.filter(i => i.id !== id); emit();
      let ok = false;
      try { ok = (await fetch('/notifications/api/mark', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id], archived: true }) })).ok; } catch (_) {}
      try { P?.WosBell?.refresh?.(true); } catch (_) {}
      refresh(); return ok;
    },
    // Badge only: this app's alerts stop coming to Chats and only count on its icon (Settings > Notifications).
    sourceOf: it => { try { const B = P?.WosBell, id = B?.routeIdOf?.(it); return id && id !== 'notifications' ? { id, name: it.appName || it.fromName || B.nameOf?.(id) || id } : null; } catch (_) { return null; } },
    badgeOnly(it) { const src = this.sourceOf(it); if (!src) return false; let ok = false; try { ok = !!P.WosBell.setRoute(src.id, 'badge'); } catch (_) {} items = items.filter(i => this.sourceOf(i)?.id !== src.id); emit(); return ok; },
  };
}

function start() {
  const NOTES = makeNotes();
  NOTES.opener = id => openNote(id);
  let thread = null, instance = null, msgs = [], msgSig = '', loading = false, sending = false, draft = '';
  let tray = [], stream = null, streamSnap = null, approval = null, apKey = '', rec = null, recT = null, menu = null;
  // Wide window: chat list on the left, open chat (or none) on the right, like Telegram Desktop. Narrow: one at a time.
  root.innerHTML = '<div class="tg-pane-list"></div><div class="tg-pane-thread tg-view"></div>';
  const listPane = root.querySelector('.tg-pane-list'), threadPane = root.querySelector('.tg-pane-thread');
  const WIDE = matchMedia('(min-width: 760px)'), wide = () => WIDE.matches;
  const listen = (type, fn, target = root) => target.addEventListener(type, e => { try { fn(e); } catch (err) { console.error(err); } });
  const host = {
    contract: 'wizard.chats-view/1', windowId: 'telegram-app', region: 'main',
    get thread() { return wide() ? null : thread; },
    get threads() { return (LIVE.sessions || []).filter(s => !s.hidden && !LIVE.agentOf?.(s.id)); },
    live: LIVE,
    isUnread: s => !!LIVE.isNew?.(s),
    emoji: s => topicEmoji(s) || (() => { try { return P.WosTopicEmoji?.get(`thread:${s.id}`, [s.attention?.subject, s.title, s.preview].filter(Boolean).join(' ')); } catch (_) { return ''; } })(),
    openThread: id => open(id), back: () => close(), renderDefault: () => paintThread(),
    // The window's CSP blocks <style> tags, so the view's stylesheet is adopted instead (no second copy shipped).
    element: tag => {
      const el = document.createElement(tag);
      if (tag !== 'style') return el;
      queueMicrotask(() => { try { const sh = new CSSStyleSheet(); sh.replaceSync(el.textContent); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sh]; } catch (e) { console.error(e); } });
      return el;
    },
    listen,
    subscribe: fn => LIVE.onChange(() => { try { fn(); } catch (e) { console.error(e); } }),
    onAppearance: fn => { const o = new MutationObserver(() => fn()); o.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-skin', 'data-color-scheme', 'class'] }); return () => o.disconnect(); },
    toast: (_i, text) => console.log(text),
    // Notifications: read straight from the Notifications app (same origin), so the tab never depends on this
    // device's Chats routing. Tap = mark read there, then open it the way Chats does (or the item's app).
    notes: NOTES,
  };
  instance = view.mount(listPane, host);
  const rowKey = r => r.dataset.chopen || (r.dataset.tgNote ? 'note:' + r.dataset.tgNote : '');
  const listRows = () => [...listPane.querySelectorAll('[data-chopen], [data-tg-note]')].filter(r => r.getClientRects().length);
  const markActive = () => { for (const r of listPane.querySelectorAll('[data-chopen], [data-tg-note]')) r.classList.toggle('tg-active', rowKey(r) === thread); };
  // The next / previous row of the list on screen (the first one when nothing is open).
  function step(dir) {
    const rows = listRows(); if (!rows.length) return;
    const i = rows.findIndex(r => rowKey(r) === thread);
    const next = rows[i < 0 ? (dir > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, i + dir))];
    if (next && rowKey(next) !== thread) { next.click(); next.scrollIntoView({ block: 'nearest' }); }
  }
  // ⌥E (or the header's archive button): archive the open chat (or clear the open notification) and open the next row, like the AI apps view.
  // Leaves the screen first, then writes: a throw or slow write never keeps the chat open, and a repeat
  // (finger lift + its click, or a double tap) within a moment never archives the next chat too.
  let doneAt = 0;
  function doneAndNext() {
    if (!thread || thread === '__new__') return;
    const now = Date.now(); if (now - doneAt < 700) return; doneAt = now;
    const rows = listRows(), i = rows.findIndex(r => rowKey(r) === thread), after = rows[i + 1] || rows[i - 1] || null, nextKey = after && rowKey(after);
    const cur = thread, note = isNote();
    if (nextKey && wide()) { if (nextKey.startsWith('note:')) openNote(nextKey.slice(5)); else open(nextKey); } else close();
    try {
      if (note) { const id = cur.slice(5); NOTES.done(id).then(ok => { if (!ok) showErr("Couldn't clear it. Try again."); }); }
      else {
        // LIVE.archive answers false (no throw) when the write failed or another write on that chat is still going; retry once.
        const fail = e => showErr(e?.message || "Couldn't archive it. Try again.");
        const go = () => Promise.resolve(LIVE.archive(cur));
        go().then(ok => ok !== false || LIVE.session(cur)?.archived ? null : new Promise(r => setTimeout(r, 1200)).then(go).then(ok2 => { if (ok2 === false && !LIVE.session(cur)?.archived) fail(); })).catch(fail);
      }
    } catch (e) { showErr(e?.message || "Couldn't archive it. Try again."); }
  }
  new MutationObserver(markActive).observe(listPane, { childList: true, subtree: true });
  const syncTheme = () => { if (listPane.dataset.tgTheme) threadPane.dataset.tgTheme = listPane.dataset.tgTheme; };
  new MutationObserver(syncTheme).observe(listPane, { attributes: true, attributeFilter: ['data-tg-theme'] });
  const show = () => { root.classList.toggle('tg-has-thread', !!thread); syncTheme(); instance.update(); if (thread) paintThread(); else paintEmpty(); markActive(); };
  WIDE.addEventListener('change', show);
  // Wizard routes Esc and the phone's back gesture to the app's Back: close the menu, then the open chat.
  const registerBack = () => window.WizardApp?.back?.register?.({ canGoBack: () => !!(menu || thread), back: () => { if (menu) closeMenu(); else if (thread) close(); else return false; return true; } });
  if (!registerBack()) addEventListener('load', registerBack, { once: true });
  show();

  /* ---------- events ---------- */
  // The archive / Done button acts on the finger lift, not only on click: a live repaint or the phone keyboard
  // closing between press and lift used to move or replace the button, and the browser then sent no click.
  let donePress = null;
  listen('pointerdown', e => { donePress = e.button === 0 && e.target.closest('[data-tg-done]') ? { x: e.clientX, y: e.clientY, t: Date.now(), id: thread } : null; });
  listen('pointercancel', () => { donePress = null; });
  addEventListener('pointerup', e => {
    const p = donePress; donePress = null;
    if (!p || p.id !== thread || Date.now() - p.t > 1500 || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 30) return;
    try { doneAndNext(); } catch (err) { console.error(err); }
    // The chat is gone from under the finger now, so the click that follows would land on the list
    // (a chat row or Archived Chats) and open it. Swallow that one click.
    ghostUntil = Date.now() + 700;
  }, true);
  let ghostUntil = 0;
  addEventListener('click', e => { if (Date.now() < ghostUntil) { ghostUntil = 0; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  listen('click', e => {
    if (menu && !e.target.closest('.tg-menu')) closeMenu();
    const mi = e.target.closest('[data-tg-menu]'); if (mi) { menuAct(mi.dataset.tgMenu, mi.dataset.id); return; }
    if (e.target.closest('.tg-menu')) return;
    if (e.target.closest('[data-tg-done]')) { doneAndNext(); return; }
    const row = e.target.closest('[data-chopen]'); if (row) { open(row.dataset.chopen); return; }
    const na = e.target.closest('[data-tg-noteact]'); if (na) { noteAct(na.dataset.tgNoteact); return; }
    if (e.target.closest('[data-chnew]')) { open('__new__'); return; }
    if (e.target.closest('[data-tg-back]')) { close(); return; }
    const ab = e.target.closest('[data-tg-attach]'); if (ab) { openAttach(ab); return; }
    const x = e.target.closest('[data-tg-unattach]'); if (x) { tray = tray.filter(f => f.key !== x.dataset.tgUnattach); paintTray(); syncSend(); return; }
    const rs = e.target.closest('[data-tg-rsum]'); if (rs) { toggleSummary(rs.dataset.tgRsum); return; }
    const vr = e.target.closest('[data-tg-vtx-retry]'); if (vr) { retryWords(vr.dataset.tgVtxRetry); return; }
    const vn = e.target.closest('[data-tg-vnote]'); if (vn) { e.preventDefault(); toggleVoice(vn.dataset.tgVnote, showErr); return; }
    if (e.target.closest('[data-tg-mic]')) { recStart(); return; }
    if (e.target.closest('[data-tg-rec-cancel]')) { recCancel(); return; }
    if (e.target.closest('[data-tg-rec-send]')) { recSend(); return; }
    if (e.target.closest('[data-tg-send]')) { send(); return; }
    if (e.target.closest('[data-tg-stop]')) { const s = LIVE.session(thread); if (s?.runId) LIVE.stop(s.runId).catch(err => showErr(err.message)); return; }
    const ap = e.target.closest('[data-tg-choice]'); if (ap) { choose(ap.dataset.tgChoice); return; }
    if (e.target.closest('[data-tg-title]') && thread && thread !== '__new__') renameBox(thread);
  });
  // Right-click on desktop, long-press on a phone: the chat's menu.
  listen('contextmenu', e => {
    const row = e.target.closest('[data-chopen]'); if (!row) return;
    e.preventDefault(); if (menu) return; openMenu(row.dataset.chopen, e.clientX, e.clientY);
  });
  // iPhone Safari never fires contextmenu on a long press, so hold-to-open is timed here too.
  let press = null;
  listen('touchstart', e => {
    const row = e.target.closest('[data-chopen]'); if (!row || e.touches.length !== 1) return;
    const t = e.touches[0];
    press = { x: t.clientX, y: t.clientY, timer: setTimeout(() => { press = { fired: true }; navigator.vibrate?.(10); openMenu(row.dataset.chopen, t.clientX, t.clientY); }, 520) };
  });
  listen('touchmove', e => { const t = e.touches[0]; if (press?.timer && Math.hypot(t.clientX - press.x, t.clientY - press.y) > 10) { clearTimeout(press.timer); press = null; } });
  listen('touchend', e => { if (press?.fired) e.preventDefault(); if (press?.timer) clearTimeout(press.timer); press = null; });
  listen('keydown', e => {
    if (e.target.matches?.('.tg-rename input')) {
      if (e.key === 'Enter') { e.preventDefault(); doRename(e.target.dataset.id, e.target.value); }
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
      return;
    }
    if (e.target.matches?.('.ch-compose textarea') && e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) { e.preventDefault(); send(); }
    if (e.target.matches?.('.tg-ap-answer') && e.key === 'Enter') { e.preventDefault(); choose('__answer'); }
    if (e.key === 'Escape') { if (menu) closeMenu(); else if (thread && !e.target.matches?.('[data-tg-search]')) close(); }
  });
  // ⌥↓ / ⌥↑: next / previous chat in THIS list (Wizard's own meaning for those keys, applied to the list in front).
  // Window capture, registered before the shell hooks the frame on load, so the shell's sidebar step doesn't also fire.
  addEventListener('keydown', e => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing || menu) return;
    if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp') return;
    e.preventDefault(); e.stopImmediatePropagation();
    step(e.code === 'ArrowDown' ? 1 : -1); keyCaps(true);
  }, true);
  // Holding ⌥ marks the rows those keys go to (⌥↑ on the one above, ⌥↓ on the one below), like Wizard's own key hints.
  function keyCaps(on) {
    for (const c of listPane.querySelectorAll('.tg-kcap')) c.remove();
    if (!on) return;
    const rows = listRows(), i = rows.findIndex(r => rowKey(r) === thread);
    const put = (r, label) => { if (!r) return; const c = document.createElement('b'); c.className = 'tg-kcap'; c.textContent = label; c.setAttribute('aria-hidden', 'true'); r.append(c); };
    put(rows[i < 0 ? 0 : i + 1], '⌥↓'); if (i > 0) put(rows[i - 1], '⌥↑');
  }
  addEventListener('keydown', e => { if (e.key === 'Alt' && !e.repeat) keyCaps(true); }, true);
  addEventListener('keyup', e => { if (e.key === 'Alt') keyCaps(false); }, true);
  addEventListener('blur', () => keyCaps(false));
  // Typing with a chat open and nothing focused goes straight into its message box (Telegram Desktop does the same).
  addEventListener('keydown', e => {
    if (!thread || menu || e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey || e.key.length !== 1) return;
    const t = e.target; if (t?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
    const ta = threadPane.querySelector('.ch-compose textarea'); if (ta) ta.focus();
  });
  listen('input', e => {
    if (!e.target.matches?.('.ch-compose textarea')) return;
    draft = e.target.value; e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 180) + 'px'; syncSend();
  });
  listen('change', e => { if (e.target.id === 'tg-file' && e.target.files?.length) { addFiles([...e.target.files]); e.target.value = ''; } });
  // Android Chrome keeps a framed page's old geometry for the Paste bubble after the keyboard resizes the frame, so the
  // first hold-to-paste put it at the top of the screen. One extra layout after each resize puts it back on the caret.
  const relayout = () => { const b = document.body; if (!b) return; b.style.minHeight = '1px'; requestAnimationFrame(() => { b.style.minHeight = ''; }); };
  window.addEventListener('resize', relayout); window.visualViewport?.addEventListener('resize', relayout);
  listen('paste', e => { const files = [...(e.clipboardData?.files || [])]; if (files.length && thread) { e.preventDefault(); addFiles(files); } });
  listen('dragover', e => { if (thread && [...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); root.classList.add('tg-drop'); } });
  listen('dragleave', e => { if (!root.contains(e.relatedTarget)) root.classList.remove('tg-drop'); });
  listen('drop', e => { root.classList.remove('tg-drop'); if (thread && e.dataTransfer?.files?.length) { e.preventDefault(); addFiles([...e.dataTransfer.files]); } });

  LIVE.onChange(() => { if (thread && thread !== '__new__') { load(); follow(); checkApproval(); } });
  setInterval(() => { const s = thread && thread !== '__new__' && LIVE.session(thread); if (s && (WORKING.has(s.status) || s.status === 'waiting_for_approval')) { load(); follow(); checkApproval(); } }, 3000);

  /* ---------- thread lifecycle ---------- */
  function open(id) {
    closeMenu(); unfollow();
    thread = id; msgs = []; msgSig = ''; draft = ''; tray = []; approval = null; apKey = '';
    if (id !== '__new__') { try { LIVE.markSeen?.(id); } catch (_) {} load(); follow(); checkApproval(); }
    show(); focusComposer();
  }
  const isNote = () => typeof thread === 'string' && thread.startsWith('note:');
  function openNote(id) { closeMenu(); unfollow(); thread = 'note:' + id; msgs = []; approval = null; NOTES.read(id); show(); }
  function noteAct(act) {
    const it = NOTES.item(thread.slice(5)); if (!it) { close(); return; }
    if (act === 'done') { NOTES.done(it.id).then(ok => { if (!ok) showErr("Couldn't clear it. Try again."); }); close(); return; }
    if (act === 'badge') { NOTES.badgeOnly(it); close(); return; }
    if (act === 'app' && typeof P?.WizOpenApp === 'function') P.WizOpenApp(it.app || it.from, it.open || '');
  }
  function paintNote() {
    const it = NOTES.item(thread.slice(5));
    if (!it) { threadPane.innerHTML = '<div class="ch-thread"><div class="ch-head"><button type="button" class="ch-back" data-tg-back aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><div class="ti"><b>Notification</b><span class="tg-sub">cleared</span></div></div><div class="ch-msgs"></div></div>'; return; }
    const src = NOTES.sourceOf(it), from = it.appName || it.fromName || (src && src.name) || 'Wizard';
    const when = it.time ? new Date(it.time * 1000) : null;
    const text = String(it.details || it.message || '').replace(/\n*\[SILENT\]\s*/g, '\n').trim();
    const app = it.app || it.from;
    syncTheme();
    threadPane.innerHTML = `<div class="ch-thread tg-note-view">
      <div class="ch-head"><button type="button" class="ch-back" data-tg-back aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><span class="tg-av emo sm tg-note-av">\u{1F514}</span><div class="ti"><b>${esc(it.title || 'Notification')}</b><span class="tg-sub">${esc(from)}</span></div></div>
      <div class="ch-msgs">${when ? `<div class="tg-day"><span>${esc(day(when.toISOString()))}</span></div>` : ''}<div class="msg a"><div class="bub"><div class="tg-text">${rich(text || it.title || '')}</div><span class="mmeta"><time>${when ? esc(clock(when.toISOString())) : ''}</time></span></div></div></div>
      <p class="tg-err" role="status"></p>
      <div class="tg-ap tg-note-acts"><div class="tg-ap-btns">${app ? `<button type="button" data-tg-noteact="app">Open ${esc(from)}</button>` : ''}${src ? `<button type="button" data-tg-noteact="badge" title="Stop sending ${esc(from)} alerts here; they only count on its icon">Badge only</button>` : ''}<button type="button" class="go" data-tg-done data-wz-key="e" data-wz-key-label="Done, then the next one" title="Done, then the next one (⌥E)">Done</button></div></div>
      ${composerHtml(false)}
    </div>`;
    const ta = threadPane.querySelector('.ch-compose textarea'); if (ta) ta.placeholder = 'Reply to start a chat about this';
    paintTray(); syncSend();
  }
  function close() { recCancel(); unfollow(); thread = null; msgs = []; msgSig = ''; approval = null; show(); }
  function paintEmpty() { threadPane.innerHTML = '<div class="ch-thread tg-none"><div class="tg-day"><span>Select a chat to start messaging</span></div></div>'; }
  async function load() {
    if (loading || !thread || thread === '__new__' || isNote()) return;
    loading = true; const id = thread;
    try {
      const rows = await LIVE.messages(id);
      if (thread !== id) return;
      msgs = rows.filter(m => m.role === 'user' || m.role === 'assistant').map(shape).filter(m => m.text || m.files.length);
      const sig = msgs.length + ':' + (msgs.at(-1)?.id || '') + ':' + (LIVE.session(id)?.status || '') + ':' + (LIVE.session(id)?.title || '');
      if (sig !== msgSig) { msgSig = sig; paintThread(); try { if (LIVE.isNew?.(LIVE.session(id))) LIVE.markSeen(id); } catch (_) {} }
    } catch (e) { console.error(e); }
    finally { loading = false; }
  }
  // Live reply: the shell's own run stream, word by word, with the tool that is running.
  function follow() {
    if (isNote()) return;
    const s = thread && LIVE.session(thread);
    const runId = s && WORKING.has(s.status) ? (s.runId || LIVE.pendingRun?.(thread) || '') : '';
    if (stream && stream.runId === runId) return;
    unfollow(); if (!runId || !LIVE.openRunStream) return;
    const sid = thread;
    const h = LIVE.openRunStream(sid, '', runId, snap => {
      if (thread !== sid) return;
      streamSnap = snap;
      if (snap.terminal) { unfollow(); msgSig = ''; load(); return; }
      paintLive();
    });
    if (h) { stream = { close: () => h.close(), runId }; streamSnap = h.snapshot; }
  }
  function unfollow() { try { stream?.close(); } catch (_) {} stream = null; streamSnap = null; }

  /* ---------- approvals and questions ---------- */
  async function checkApproval() {
    if (isNote()) return;
    const s = thread && LIVE.session(thread); const id = thread;
    if (!s?.runId || !['waiting_for_approval', 'running'].includes(s.status)) { if (approval) { approval = null; apKey = ''; paintThread(); } return; }
    try {
      const run = await LIVE.run(s.runId); if (thread !== id) return;
      const ap = Array.isArray(run.pending_controls) ? run.pending_controls.map(KIT.normalizeApproval).find(Boolean) : KIT.normalizeApproval(run.approval);
      const key = ap ? JSON.stringify([s.runId, ap.kind, ap.requestId, ap.generation]) : '';
      if (key === apKey) return;
      apKey = key; approval = ap ? { ...ap, runId: s.runId } : null; paintThread();
    } catch (_) {}
  }
  async function choose(choice) {
    const ap = approval; if (!ap || ap.pending) return;
    const answer = choice === '__answer' ? root.querySelector('.tg-ap-answer')?.value.trim() : choice;
    if (ap.kind === 'clarify' && !answer) return;
    ap.pending = true; paintThread();
    try {
      if (ap.kind === 'clarify') await LIVE.clarify(ap.runId, answer, ap.requestId, ap.generation);
      else await LIVE.approve(ap.runId, choice, ap.requestId, ap.generation);
      approval = null; paintThread(); setTimeout(() => { LIVE.refresh?.(); load(); }, 800);
    } catch (e) { ap.pending = false; paintThread(); showErr(e.message || 'Could not answer'); }
  }

  /* ---------- the chat menu: rename, mark read, archive ---------- */
  function openMenu(id, x, y) {
    closeMenu();
    if (!LIVE.session(id)) return;
    menu = document.createElement('div'); menu.className = 'tg-menu'; menu.setAttribute('role', 'menu');
    menu.innerHTML = `<button type="button" data-tg-menu="rename" data-id="${esc(id)}">✏️ Rename</button><button type="button" data-tg-menu="read" data-id="${esc(id)}">✓ Mark as read</button><button type="button" data-tg-menu="archive" data-id="${esc(id)}">🗄 Archive</button>`;
    root.append(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  }
  function closeMenu() { menu?.remove(); menu = null; }
  // Attach menu (like Telegram's paperclip): camera, photos/videos or any file, instead of one picker for everything.
  const PICK = { camera: ['image/*', 'environment', false], photos: ['image/*,video/*', '', true], file: ['*/*', '', true] };
  function openAttach(btn) {
    closeMenu();
    const cam = matchMedia('(pointer: coarse)').matches;
    menu = document.createElement('div'); menu.className = 'tg-menu tg-attach-menu'; menu.setAttribute('role', 'menu');
    menu.innerHTML = (cam ? '<button type="button" data-tg-menu="camera">📷 Camera</button>' : '') +
      '<button type="button" data-tg-menu="photos">🖼 Photo or video</button><button type="button" data-tg-menu="file">📄 File</button>';
    root.append(menu);
    const b = btn.getBoundingClientRect(), r = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(b.left, innerWidth - r.width - 8)) + 'px';
    menu.style.top = Math.max(8, b.top - r.height - 6) + 'px';
  }
  function pick(kind) {
    const input = root.querySelector('#tg-file'); if (!input) return;
    const [accept, capture, multi] = PICK[kind];
    input.accept = accept; input.multiple = multi;
    if (capture) input.setAttribute('capture', capture); else input.removeAttribute('capture');
    input.click();
  }
  function menuAct(act, id) {
    if (PICK[act]) { closeMenu(); pick(act); return; }
    if (act === 'save') { doRename(id, menu?.querySelector('input')?.value); return; }
    closeMenu();
    if (act === 'rename') renameBox(id);
    if (act === 'read') { try { LIVE.markSeen(id); } catch (_) {} instance.update(); }
    if (act === 'archive') Promise.resolve(LIVE.archive(id)).catch(e => showErr(e.message));
  }
  function renameBox(id) {
    closeMenu();
    const s = LIVE.session(id); if (!s) return;
    menu = document.createElement('div'); menu.className = 'tg-menu tg-rename';
    menu.innerHTML = `<b>Rename chat</b><input maxlength="60" data-id="${esc(id)}" value="${esc(s.title || '')}" aria-label="Chat name"><div class="tg-rename-btns"><button type="button" data-tg-menu="cancel">Cancel</button><button type="button" class="go" data-tg-menu="save" data-id="${esc(id)}">Save</button></div>`;
    root.append(menu);
    const input = menu.querySelector('input'); input.focus(); input.select();
  }
  async function doRename(id, title) {
    const t = String(title || '').trim(); if (!t) return;
    closeMenu();
    const ok = await LIVE.rename(id, t);
    if (ok === 'taken') showErr('Another chat already has that name.');
    else if (!ok) showErr('Could not rename right now.');
    if (thread === id) paintThread(); else instance.update();
  }

  /* ---------- attachments ---------- */
  async function upload(file) {
    if (P.WizUploads?.supported?.()) {
      try { return await P.WizUploads.upload(file); } catch (e) { if (!(e.status === 404 || e.status === 405) || e.code) throw e; }
    }
    const r = await fetch('/wizard/files/upload', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream', 'X-Wizard-Filename': file.name || 'upload', 'X-Wizard-Mime': file.type || 'application/octet-stream' }, body: file });
    if (!r.ok) throw new Error(r.status === 413 ? 'That file is too large.' : `Upload failed (${r.status}).`);
    const f = (await r.json()).file || {}; return { id: String(f.id), name: f.filename || file.name, mime: f.mime || file.type, bytes: f.bytes || file.size };
  }
  function addFiles(files) {
    for (const file of files) {
      const t = { key: Math.random().toString(36).slice(2), name: file.name, mime: file.type, uploading: true, preview: /^image\//.test(file.type) ? URL.createObjectURL(file) : '' };
      tray.push(t);
      upload(file).then(f => { Object.assign(t, f, { uploading: false }); if (/^image\//.test(file.type) && f.id) t.preview = `/wizard/files/${encodeURIComponent(f.id)}/content`; paintTray(); syncSend(); },
        e => { tray = tray.filter(x => x !== t); paintTray(); syncSend(); showErr(e.message || 'Upload failed'); });
    }
    paintTray(); syncSend();
  }
  function paintTray() {
    const el = root.querySelector('.tg-tray'); if (!el) return;
    el.innerHTML = tray.map(f => `<span class="tg-chip${f.uploading ? ' up' : ''}">${f.preview ? `<img src="${esc(f.preview)}" alt="">` : '<i>📄</i>'}<span>${esc(f.name)}</span>${f.uploading ? '<em class="tg-spin"></em>' : ''}<button type="button" data-tg-unattach="${f.key}" aria-label="Remove">×</button></span>`).join('');
    el.hidden = !tray.length;
  }

  /* ---------- voice notes (the shell's recorder and transcriber) ---------- */
  // The desktop shell's recorder also transcribes; the phone shell has none, so a plain recorder sends the audio
  // and your Wizard listens to it (the same as a voice note from the phone's own chat).
  function plainRecorder() {
    let stream = null, mr = null, chunks = [];
    return {
      async start() {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg'].find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
        mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
        mr.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
        mr.start(500);
      },
      finish() {
        return new Promise(resolve => {
          mr.onstop = () => { stream.getTracks().forEach(t => t.stop()); resolve({ text: '', blob: new Blob(chunks, { type: (mr.mimeType || 'audio/webm').split(';')[0] }) }); };
          mr.stop();
        });
      },
      cancel() { try { mr?.stop(); } catch (_) {} stream?.getTracks().forEach(t => t.stop()); },
    };
  }
  async function recStart() {
    if (rec) return;
    if (!navigator.mediaDevices?.getUserMedia) return showErr('Voice isn’t available here.');
    try {
      const v = P.WizCore?.voice ? P.WizCore.voice({ onState() {}, onLevel() {} }) : plainRecorder();
      rec = { v, at: Date.now() };
      paintComposer();
      await v.start();
      recT = setInterval(() => { const t = root.querySelector('.tg-rec-time'); if (t && rec) t.textContent = fmtTime(Date.now() - rec.at); }, 250);
    } catch (e) { rec = null; paintComposer(); showErr(e.name === 'NotAllowedError' ? 'Allow the microphone to send voice messages.' : (e.message || 'Microphone unavailable')); }
  }
  function recCancel() { if (!rec) return; try { rec.v.cancel(); } catch (_) {} rec = null; clearInterval(recT); paintComposer(); }
  async function recSend() {
    if (!rec) return; const r = rec; rec = null; clearInterval(recT);
    paintComposer(true);
    try {
      const out = await r.v.finish();
      if (!out?.blob) throw new Error(out?.error || 'Nothing was recorded');
      const type = out.blob.type || 'audio/webm';
      const ext = /mp4|m4a|aac/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
      const file = new File([out.blob], `wizard-voice-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`, { type });
      const f = await upload(file);
      for (let i = 0; i < 120 && tray.some(t => t.uploading); i++) await new Promise(r => setTimeout(r, 250));
      const extra = tray.map(t => t.id).filter(Boolean), sent = tray; tray = [];
      paintComposer();
      try { await deliver((out.text || '').trim() || '🎤 Voice message', [f.id, ...extra]); }
      catch (e) { tray = sent; paintTray(); throw e; }
    } catch (e) { paintComposer(); showErr(e.message || 'Voice note failed'); }
  }

  /* ---------- sending ---------- */
  async function send() {
    const ta = root.querySelector('.ch-compose textarea'); const text = (ta?.value || '').trim();
    if (tray.some(f => f.uploading)) return showErr('Wait for the file to finish uploading.');
    const ids = tray.map(f => f.id).filter(Boolean);
    if (!text && !ids.length) return;
    draft = ''; if (ta) { ta.value = ''; ta.style.height = ''; }
    const sent = tray; tray = []; paintTray(); syncSend();
    try { await deliver(text || '📎', ids); }
    catch (e) { tray = sent; draft = text; paintThread(); const t = root.querySelector('.ch-compose textarea'); if (t && !t.value) t.value = text; syncSend(); showErr(e.message || 'Could not send'); }
  }
  async function deliver(text, fileIds = []) {
    if (sending) throw new Error('Still sending the last message');
    sending = true;
    // A reply to a notification starts a new chat that carries it, then clears the notification.
    let noteId = '', prevThread = thread;
    if (isNote()) {
      const it = NOTES.item(thread.slice(5)); noteId = it?.id || '';
      if (it) { const body = String(it.details || it.message || '').replace(/\n*\[SILENT\]\s*/g, '\n').trim().slice(0, 1500);
        text = `Re: notification "${it.title || 'Notification'}"${it.appName || it.fromName ? ` from ${it.appName || it.fromName}` : ''}\n> ${body.split('\n').join('\n> ')}\n\n${text}`; }
      thread = '__new__'; msgs = [];
    }
    msgs.push({ id: 'pending', role: 'user', text, files: [], timestamp: Date.now() / 1000, pending: true }); paintThread();
    try {
      const opts = fileIds.length ? { fileIds } : {};
      if (thread === '__new__') { const r = await LIVE.send(text, opts); thread = r.sessionId; root.querySelector('.ch-thread[data-tg-for="__new__"]')?.setAttribute('data-tg-for', thread); if (noteId) NOTES.done(noteId); }
      else await LIVE.reply(thread, text, opts);
      msgSig = ''; setTimeout(() => { load(); follow(); }, 700);
    } catch (e) { msgs = msgs.filter(m => m.id !== 'pending'); if (noteId) thread = prevThread; paintThread(); throw e; }
    finally { sending = false; }
  }
  function showErr(text) { const err = root.querySelector('.tg-err'); if (err) { err.textContent = text; setTimeout(() => { if (err.textContent === text) err.textContent = ''; }, 6000); } else console.warn(text); }
  function focusComposer() { const ta = root.querySelector('.ch-compose textarea'); if (ta && matchMedia('(pointer: fine)').matches) ta.focus(); }
  // Telegram's one round button: a mic while the box is empty, Send once there is something to send (plus a mic
  // beside it while only attachments wait).
  function syncSend() {
    const b = root.querySelector('form.ch-compose .tg-sendbtn'); if (!b) return;
    const has = !!(root.querySelector('.ch-compose textarea')?.value.trim() || tray.length);
    b.dataset.mode = has ? 'send' : 'mic';
    b.toggleAttribute('data-tg-send', has); b.toggleAttribute('data-tg-mic', !has);
    b.setAttribute('aria-label', has ? 'Send' : 'Record a voice message');
    // Photos attached and nothing typed: keep a mic beside Send so a voice note can go with them.
    const mic = root.querySelector('form.ch-compose .tg-micbtn');
    if (mic) mic.hidden = !(tray.length && !root.querySelector('.ch-compose textarea')?.value.trim());
  }

  /* ---------- painting ---------- */
  const ICON_BTN = '<svg viewBox="0 0 24 24" class="i-send"><path d="M4 12l16-8-6 16-2-7z"/></svg><svg viewBox="0 0 24 24" class="i-mic"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path class="ln" d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  function composerHtml(busy) {
    if (rec) return `<div class="tg-tray" hidden></div><div class="ch-compose tg-recbar"><button type="button" class="ch-attach" data-tg-attach aria-label="Attach" title="Attach a photo or file"><svg viewBox="0 0 24 24"><path d="M21 12.5l-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.3-8.3"/></svg></button><button type="button" class="tg-rec-x" data-tg-rec-cancel aria-label="Cancel">✕</button><span class="tg-rec-dot"></span><span class="tg-rec-time">0:00</span><span class="tg-rec-hint">Recording…</span><button type="button" class="tg-sendbtn" data-mode="send" data-tg-rec-send aria-label="Send voice message">${ICON_BTN}</button></div><input type="file" id="tg-file" multiple hidden>`;
    if (busy) return `<div class="ch-compose tg-recbar"><em class="tg-spin"></em><span class="tg-rec-hint">Sending voice message…</span></div>`;
    return `<div class="tg-tray" hidden></div><form class="ch-compose"><button type="button" class="ch-attach" data-tg-attach aria-label="Attach" title="Attach a photo or file"><svg viewBox="0 0 24 24"><path d="M21 12.5l-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.3-8.3"/></svg></button><textarea rows="1" placeholder="Message" aria-label="Message">${esc(draft)}</textarea><button type="button" class="tg-micbtn" data-tg-mic aria-label="Record a voice message to send with the attachments" title="Voice note with the attachments" hidden><svg viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path class="ln" d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button><button type="button" class="tg-sendbtn" data-mode="mic" data-tg-mic aria-label="Record a voice message">${ICON_BTN}</button></form><input type="file" id="tg-file" multiple hidden>`;
  }
  function paintComposer(busy = false) {
    const box = root.querySelector('.tg-composer'); if (!box) return;
    box.innerHTML = composerHtml(busy); paintTray(); syncSend();
  }
  function liveHtml() {
    const s = thread && thread !== '__new__' ? LIVE.session(thread) : null;
    if (!s || !WORKING.has(s.status)) return '';
    const text = strip(streamSnap?.text || ''), step = (streamSnap?.steps || []).filter(x => !x.done).at(-1);
    const stepLine = step ? `<span class="tg-step">⚙️ ${esc(String(step.tool).replace(/_/g, ' '))}…</span>` : '';
    if (!text) return `<div class="msg a tg-live"><div class="bub tg-typing">${stepLine}<span class="tg-dots"><i></i><i></i><i></i></span></div></div>`;
    return `<div class="msg a tg-live"><div class="bub"><div class="tg-text">${rich(text)}</div>${stepLine ? `<div>${stepLine}</div>` : ''}</div></div>`;
  }
  function paintLive() {
    const m = root.querySelector('.ch-msgs'); if (!m) return;
    const atBottom = m.scrollHeight - m.scrollTop - m.clientHeight < 80;
    const old = m.querySelector('.tg-live'), html = liveHtml();
    if (old) { if (html) old.outerHTML = html; else old.remove(); } else if (html) m.insertAdjacentHTML('beforeend', html);
    if (atBottom) m.scrollTop = m.scrollHeight;
  }
  function approvalHtml() {
    const ap = approval; if (!ap) return '';
    const dis = ap.pending ? ' disabled' : '';
    const buttons = ap.kind === 'clarify'
      ? `${(ap.choices || []).map(c => `<button type="button" data-tg-choice="${esc(c.value)}"${dis}>${esc(c.label)}</button>`).join('')}<div class="tg-ap-row"><input class="tg-ap-answer" placeholder="Your answer"><button type="button" class="go" data-tg-choice="__answer"${dis}>Send</button></div>`
      : (ap.choices || []).map(c => `<button type="button" class="${/^(once|session|always|approve|allow|yes)/i.test(c.value) ? 'go' : ''}" data-tg-choice="${esc(c.value)}"${dis}>${esc(c.label)}</button>`).join('');
    return `<div class="tg-ap"><b>${ap.kind === 'clarify' ? 'Question from your Wizard' : 'Your Wizard asks permission'}</b><p>${esc(ap.action)}</p><div class="tg-ap-btns">${buttons}</div></div>`;
  }
  // Long replies open on their short answer (the line the chat list shows); a tap shows the whole reply.
  // Collapsed unless the owner chose expanded for Chats (box-wide); a tap on one reply wins over that.
  const SUMMARY_WORDS = 40, rsumOpen = new Map();
  function summaryOf(m) {
    if (!m.ask || m.pending) return '';
    const words = String(m.text || '').split(/\s+/).filter(Boolean).length;
    return words > SUMMARY_WORDS && words > 2 * m.ask.split(/\s+/).length ? m.ask : '';
  }
  function summaryStartsOpen() { try { return P.WosSkinHost?.replySummary?.get?.().start === 'expanded'; } catch (_) { return false; } }
  function toggleSummary(key) {
    const msg = root.querySelector(`[data-tg-rsum="${CSS.escape(key)}"]`)?.closest('.msg'); if (!msg) return;
    const lead = msg.querySelector('.tg-rsum'), full = msg.querySelector('.tg-rdet'), open = !lead.hidden ? true : false;
    rsumOpen.set(key, open); lead.hidden = open; full.hidden = !open;
    if (!open) lead.scrollIntoView({ block: 'nearest' });
  }
  function paintThread() {
    if (!thread) return;
    if (isNote()) { paintNote(); return; }
    const s = thread !== '__new__' ? LIVE.session(thread) : null;
    const old = root.querySelector('.ch-msgs');
    const keepBottom = !old || old.scrollHeight - old.scrollTop - old.clientHeight < 80, prevTop = old?.scrollTop || 0;
    const ta0 = root.querySelector('.ch-compose textarea'), typing = ta0 && document.activeElement === ta0, sel = typing ? [ta0.selectionStart, ta0.selectionEnd] : null;
    if (ta0) draft = ta0.value;
    const answer = root.querySelector('.tg-ap-answer')?.value || '';
    let lastDay = '', body = '';
    const folded = new Set();
    for (let i = 0; i < msgs.length; i++) if (msgs[i].role === 'assistant' && msgs[i + 1]?.role === 'assistant') folded.add(i);
    let foldOpen = false;
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (folded.has(i) && !folded.has(i - 1)) { let n = 0; while (folded.has(i + n)) n++; body += `<details class="tg-fold"><summary><span>${n} in-between ${n === 1 ? 'message' : 'messages'}</span></summary>`; foldOpen = true; }
      const d = day(m.timestamp); if (d && d !== lastDay) { body += `<div class="tg-day"><span>${esc(d)}</span></div>`; lastDay = d; }
      const u = m.role === 'user';
      const files = (m.files || []).map(fileHtml).join('');
      const hide = files && ['🎤 Voice message', '📎'].includes(m.text);
      const text = m.text && !hide ? (u ? esc(m.text).replace(/\n/g, '<br>') : rich(m.text)) : '';
      const lead = !u && summaryOf(m), rk = esc(String(m.id ?? m.timestamp)), open = lead && (rsumOpen.get(String(m.id ?? m.timestamp)) ?? summaryStartsOpen());
      const shown = !text ? '' : !lead ? `<div class="tg-text">${text}</div>`
        : `<button type="button" class="tg-rsum" data-tg-rsum="${rk}" aria-expanded="false"${open ? ' hidden' : ''}><span>${esc(/[.!?…"'”’»]$/u.test(lead) ? lead : lead + '.')}</span><i class="tg-chev" aria-hidden="true"></i></button>`
          + `<div class="tg-rdet"${open ? '' : ' hidden'}><div class="tg-text">${text}</div><button type="button" class="tg-rless" data-tg-rsum="${rk}" aria-expanded="true">Show less<i class="tg-chev up" aria-hidden="true"></i></button></div>`;
      body += `<div class="msg ${u ? 'u' : 'a'}${m.pending ? ' pending' : ''}${lead ? ' has-rsum' : ''}"><div class="bub">${files}${shown}<span class="mmeta"><time>${esc(clock(m.timestamp))}</time></span></div></div>`;
      if (foldOpen && !folded.has(i + 1)) { body += '</details>'; foldOpen = false; }
    }
    body += liveHtml();
    if (!body) body = thread === '__new__' ? '<div class="tg-day"><span>New chat with your Wizard</span></div>' : '<div class="tg-day"><span>Loading…</span></div>';
    const working = s && WORKING.has(s.status);
    const status = working ? 'typing…' : s?.status === 'waiting_for_approval' ? 'waiting for you' : 'online';
    syncTheme();
    const head = `<div class="ch-head"><button type="button" class="ch-back" data-tg-back aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><span class="tg-av emo sm"></span><div class="ti" data-tg-title title="Tap to rename"><b>${esc(cleanTitle(s?.title) || 'New chat')}</b><span class="tg-sub${working ? ' on' : ''}">${status}</span></div>${thread !== '__new__' ? '<button type="button" class="tg-ibtn tg-headbtn" data-tg-done data-wz-key="e" data-wz-key-label="Archive, then the next chat" title="Archive, then the next chat (⌥E)" aria-label="Archive, then the next chat"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/></svg></button>' : ''}${working ? '<button type="button" class="tg-stop" data-tg-stop aria-label="Stop" title="Stop">■</button>' : ''}</div>`;
    // Same chat already on screen: update head, messages and approval in place and keep the composer element.
    // Replacing the textarea mid long-press (the first load lands right after opening) left the phone's
    // Paste bubble attached to a removed box, off screen or dead until the chat was reopened.
    const cur = threadPane.querySelector('.ch-thread[data-tg-for]');
    const reuse = cur && cur.querySelector('.tg-composer') && cur.dataset.tgFor === thread;
    if (reuse) {
      // Patch the header in place so its buttons stay the same nodes a finger may be pressing.
      const h = cur.querySelector('.ch-head');
      h.querySelector('.ti b').textContent = cleanTitle(s?.title) || 'New chat';
      const sub = h.querySelector('.tg-sub'); sub.textContent = status; sub.classList.toggle('on', !!working);
      const stop = h.querySelector('[data-tg-stop]');
      if (working && !stop) h.insertAdjacentHTML('beforeend', '<button type="button" class="tg-stop" data-tg-stop aria-label="Stop" title="Stop">■</button>');
      else if (!working && stop) stop.remove();
      cur.querySelector('.ch-msgs').innerHTML = body;
      cur.querySelector('.tg-apbox').innerHTML = approvalHtml();
    } else threadPane.innerHTML = `<div class="ch-thread" data-tg-for="${esc(thread)}">
      ${head}
      <div class="ch-msgs">${body}</div>
      <div class="tg-apbox">${approvalHtml()}</div>
      <p class="tg-err" role="status"></p>
      <div class="tg-composer">${composerHtml(false)}</div>
    </div>`;
    const av = root.querySelector('.ch-head .tg-av');
    av.textContent = host.emoji(s || { id: thread, title: 'New chat' }) || '💬';
    av.style.background = 'color-mix(in srgb, var(--tg-primary) 22%, transparent)';
    const ans = root.querySelector('.tg-ap-answer'); if (ans) ans.value = answer;
    const m = root.querySelector('.ch-msgs'); m.scrollTop = keepBottom ? m.scrollHeight : prevTop;
    paintTray(); syncSend();
    if (typing && !reuse) { const ta = root.querySelector('.ch-compose textarea'); ta.focus({ preventScroll: true }); ta.setSelectionRange(...sel); }
  }
}
