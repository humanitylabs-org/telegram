// Telegram: the same Wizard chats, drawn the way Telegram draws them.
// Contract wizard.chats-view/1 (wizard-ux docs/CHATS-VIEW.md). The list is ours; the thread is the
// standard Chats thread (send, voice, attachments, approvals all unchanged) restyled as Telegram bubbles.
// Rows carry data-chopen / data-chnew so the shell's own tap, long-press and new-chat handling applies.

const STYLE_ID = 'tg-chats-style';
const AVATARS = [
  ['#ff885e', '#ff516a'], ['#ffcd6a', '#ffa85c'], ['#82b1ff', '#665fff'], ['#a0de7e', '#54cb68'],
  ['#53edd6', '#28c9b7'], ['#72d5fd', '#2a9ef1'], ['#e0a2f3', '#d669ed'],
];
// Every chat is Ready or Working; the shell's notifications have their own tab (Miguel, 14 Nov 2026: no All chats).
const FOLDERS = [['ready', 'Ready'], ['working', 'Working'], ['notes', 'Notifications']];
const WORKING = new Set(['submitting', 'queued', 'running', 'stopping']);
let mounted = 0;

const CSS = `
.tg-view { --tg-font: Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", system-ui, sans-serif; }
.tg-view[data-tg-theme="dark"] {
  --tg-bg: #212121; --tg-head: #212121; --tg-text: #ffffff; --tg-sub: #aaaaaa; --tg-line: #303030;
  --tg-primary: #8774e1; --tg-green: #00c73e; --tg-badge-muted: #5b5b5b; --tg-hover: #2c2c2c; --tg-search: #181818;
  --tg-in: #212121; --tg-out: #766ac8; --tg-out-text: #ffffff; --tg-out-meta: rgba(255,255,255,.6); --tg-check: #ffffff;
  --tg-wall: radial-gradient(circle at 18% 12%, rgba(118,92,214,.45), transparent 42%),
             radial-gradient(circle at 88% 30%, rgba(42,130,150,.40), transparent 46%),
             radial-gradient(circle at 75% 88%, rgba(80,110,60,.38), transparent 48%),
             radial-gradient(circle at 10% 85%, rgba(140,70,140,.35), transparent 45%), #0f0f13;
  --tg-compose: #212121; --tg-danger: #e53935;
}
.tg-view[data-tg-theme="light"] {
  --tg-bg: #ffffff; --tg-head: #ffffff; --tg-text: #000000; --tg-sub: #707579; --tg-line: #dadce0;
  --tg-primary: #3390ec; --tg-green: #4fae4e; --tg-badge-muted: #c4c9cc; --tg-hover: #f4f4f5; --tg-search: #f4f4f5;
  --tg-in: #ffffff; --tg-out: #eeffde; --tg-out-text: #000000; --tg-out-meta: #4fae4e; --tg-check: #4fae4e;
  --tg-wall: radial-gradient(circle at 15% 20%, #dbddbb, transparent 55%),
             radial-gradient(circle at 85% 25%, #6ba587, transparent 55%),
             radial-gradient(circle at 80% 85%, #d5d88d, transparent 55%),
             radial-gradient(circle at 20% 80%, #88b884, transparent 55%), #b9cfa0;
  --tg-compose: #ffffff; --tg-danger: #e53935;
}

/* ---------- chat list ---------- */
.tg-list { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--tg-bg); color: var(--tg-text); font-family: var(--tg-font); }
.tg-top { flex: none; display: flex; align-items: center; gap: 6px; padding: calc(var(--wos-cutout, 0px) + 8px) 10px 6px; }
.tg-top h1 { flex: 1; margin: 0 0 0 6px; font-size: 20px; font-weight: 600; letter-spacing: .01em; }
.tg-sweep { flex: none; height: 32px; padding: 0 12px 0 9px; border-radius: 16px; display: flex; align-items: center; gap: 5px; border: 0; cursor: pointer; background: var(--tg-hover); color: var(--tg-primary); font: inherit; font-size: 14px; font-weight: 600; }
.tg-sweep svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.tg-sweep:hover { filter: brightness(1.15); }
/* Tapped: the broom sweeps back and forth and a shimmer runs across until the sweep chat opens (Miguel, 19 Nov 2026). */
.tg-sweep.busy { cursor: progress; background: linear-gradient(90deg, var(--tg-hover) 0%, color-mix(in srgb, var(--tg-primary) 28%, var(--tg-hover)) 50%, var(--tg-hover) 100%) 0 0 / 200% 100%; animation: tg-shimmer 1.1s linear infinite; }
.tg-sweep.busy svg { transform-origin: 70% 30%; animation: tg-broom .45s ease-in-out infinite alternate; }
@keyframes tg-shimmer { to { background-position: -200% 0; } }
@keyframes tg-broom { from { transform: rotate(-18deg); } to { transform: rotate(18deg); } }
@media (prefers-reduced-motion: reduce) { .tg-sweep.busy, .tg-sweep.busy svg { animation: none; } .tg-sweep.busy { opacity: .7; } }
/* Catch me up (switch catch-me-up): the same pill with a sparkle; while the catch-up chat runs the sparkle twinkles
   and a small spinner turns next to the label (Miguel, 20 Nov 2026). */
.tg-sweep.busy.tg-catchup svg { transform-origin: 50% 50%; animation: tg-twinkle .6s ease-in-out infinite alternate; }
.tg-catchup .tg-spin { width: 14px; height: 14px; margin-left: 3px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: tg-spin .8s linear infinite; }
@keyframes tg-twinkle { from { transform: scale(.8) rotate(-12deg); opacity: .55; } to { transform: scale(1.12) rotate(12deg); opacity: 1; } }
@keyframes tg-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .tg-sweep.busy.tg-catchup svg, .tg-catchup .tg-spin { animation: none; } }
.tg-ibtn { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: var(--tg-sub); background: none; border: 0; cursor: pointer; }
.tg-ibtn:active, .tg-ibtn:hover { background: var(--tg-hover); }
.tg-ibtn svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.tg-search { flex: none; margin: 0 10px 4px; position: relative; }
.tg-search input { width: 100%; height: 42px; box-sizing: border-box; border-radius: 22px; border: 2px solid transparent; background: var(--tg-search); color: var(--tg-text);
  padding: 0 14px 0 44px; font: 400 16px var(--tg-font); outline: 0; }
.tg-search input:focus { border-color: var(--tg-primary); background: var(--tg-bg); }
.tg-search input::placeholder { color: var(--tg-sub); }
.tg-search svg { position: absolute; left: 14px; top: 11px; width: 20px; height: 20px; fill: none; stroke: var(--tg-sub); stroke-width: 2; stroke-linecap: round; pointer-events: none; }
.tg-tabs { flex: none; display: flex; gap: 0; padding: 0 4px; border-bottom: 1px solid var(--tg-line); overflow-x: auto; scrollbar-width: none; }
.tg-tabs::-webkit-scrollbar { display: none; }
.tg-tab { position: relative; flex: 0 1 auto; min-width: 0; padding: 10px 6px 9px; border: 0; background: none; color: var(--tg-sub); font: 500 13.5px var(--tg-font); cursor: pointer; display: flex; align-items: center; gap: 4px; white-space: nowrap; }
.tg-tab span { overflow: hidden; text-overflow: ellipsis; }
.tg-tab[aria-selected="true"] { color: var(--tg-primary); }
.tg-tab[aria-selected="true"]::after { content: ""; position: absolute; left: 6px; right: 6px; bottom: -1px; height: 3px; border-radius: 3px 3px 0 0; background: var(--tg-primary); }
.tg-tab i { font-style: normal; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 10px; background: var(--tg-badge-muted); color: #fff; font-size: 12px; font-weight: 600; display: grid; place-items: center; }
.tg-tab[aria-selected="true"] i { background: var(--tg-primary); }
.tg-scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 4px 6px 96px; scrollbar-width: none; }
.tg-scroll::-webkit-scrollbar { display: none; }
.tg-row { width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px 8px; border: 0; border-radius: 12px; background: none; color: inherit; text-align: left; cursor: pointer; font-family: var(--tg-font); }
.tg-row:hover { background: var(--tg-hover); }
.tg-row:active { background: var(--tg-hover); }
.tg-av { flex: none; width: 54px; height: 54px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-size: 20px; font-weight: 600; letter-spacing: .02em; position: relative; }
.tg-av.sm { width: 42px; height: 42px; font-size: 16px; }
.tg-av.emo { font-size: 27px; line-height: 1; }
.tg-av.sm.emo { font-size: 21px; }
.tg-av.arch { background: var(--tg-badge-muted); }
.tg-av.arch svg, .tg-av.saved svg { width: 26px; height: 26px; fill: none; stroke: #fff; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.tg-av.live::after { content: ""; position: absolute; right: 1px; bottom: 1px; width: 12px; height: 12px; border-radius: 50%; background: var(--tg-green); border: 2.5px solid var(--tg-bg); }
.tg-bd { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.tg-l1, .tg-l2 { display: flex; align-items: center; gap: 6px; min-width: 0; }
.tg-l1 b { flex: 1; min-width: 0; font-size: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tg-l1 time { flex: none; font-size: 12.5px; color: var(--tg-sub); }
.tg-tick { flex: none; width: 18px; height: 14px; fill: none; stroke: var(--tg-green); stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.tg-l2 span { flex: 1; min-width: 0; font-size: 15px; color: var(--tg-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tg-l2 span em { font-style: normal; color: var(--tg-primary); }
.tg-l2 span strong { font-weight: 400; color: var(--tg-text); }
.tg-badge { flex: none; min-width: 22px; height: 22px; padding: 0 7px; box-sizing: border-box; border-radius: 11px; display: grid; place-items: center; color: #fff; font-size: 13px; font-weight: 600; background: var(--tg-green); }
.tg-badge.dot { min-width: 12px; width: 12px; height: 12px; padding: 0; margin: 0 5px; }
.tg-badge.at { background: var(--tg-primary); }
.tg-askchip { align-self: flex-start; max-width: 100%; box-sizing: border-box; padding: 2px 9px; border-radius: 10px; font-size: .8125rem; color: var(--tg-primary); background: color-mix(in srgb, var(--tg-primary) 14%, transparent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.tg-askchip:hover { background: color-mix(in srgb, var(--tg-primary) 22%, transparent); }
.tg-askchip.older { color: var(--tg-sub); background: color-mix(in srgb, var(--tg-sub) 12%, transparent); }
.tg-badge.err { background: var(--tg-danger); }
.tg-row.unread .tg-l1 b { font-weight: 700; }
.tg-note-av { background: color-mix(in srgb, #f5b82e 30%, transparent); }
.tg-empty { padding: 60px 24px; text-align: center; color: var(--tg-sub); font: 400 15px/1.4 var(--tg-font); }
.tg-empty b { display: block; margin-bottom: 4px; color: var(--tg-text); font-size: 17px; font-weight: 600; }
.tg-fab { position: absolute; right: 18px; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); width: 56px; height: 56px; border-radius: 50%; border: 0; display: grid; place-items: center;
  background: var(--tg-primary); color: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.25); cursor: pointer; z-index: 2; }
.tg-fab svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.tg-wrap { position: relative; height: 100%; min-height: 0; }
/* Collapsed: a narrow list shows avatars only, with their badges, like Telegram Desktop's folded chat column. */
.tg-wrap { container-type: inline-size; }
@container (max-width: 150px) {
  .tg-top h1, .tg-search, .tg-tabs, .tg-bd, .tg-fab, .tg-empty, .tg-sweep { display: none; }
  .tg-top { justify-content: center; padding-left: 0; padding-right: 0; }
  .tg-scroll { padding: 4px 4px 24px; }
  .tg-row { justify-content: center; padding: 6px 0; position: relative; }
  .tg-row .tg-av { width: 48px; height: 48px; }
  .tg-row.unread .tg-av::before { content: ""; position: absolute; top: 0; right: 0; width: 12px; height: 12px; border-radius: 50%; background: var(--tg-primary); box-shadow: 0 0 0 2px var(--tg-bg); }
}

/* ---------- thread: the standard Chats thread in Telegram dress ---------- */
.tg-view.tg-view .ch-thread, .tg-view .ch-thread.ch-thread { background: var(--tg-wall); font-family: var(--tg-font); color: var(--tg-text); }
.tg-view.tg-view .ch-head { background: var(--tg-head); border-bottom: 1px solid var(--tg-line); color: var(--tg-text); min-height: 56px; padding: 6px 8px 6px 4px; gap: 10px; }
.tg-view.tg-view .ch-head .ch-back svg { stroke: var(--tg-sub); }
.tg-view.tg-view .ch-head .ti { flex-direction: column; align-items: flex-start; justify-content: center; }
.tg-view.tg-view .ch-head .ti b { font-size: 16px; font-weight: 600; color: var(--tg-text); }
.tg-view.tg-view .ch-head .tg-sub { display: block; font-size: 13.5px; color: var(--tg-sub); line-height: 1.2; margin-top: 1px; }
.tg-view.tg-view .ch-head .tg-sub.on { color: var(--tg-primary); }
.tg-view.tg-view .ch-head .tg-av { width: 42px; height: 42px; font-size: 16px; }
.tg-view.tg-view .ch-head .tg-av.emo { font-size: 22px; }
.tg-view.tg-view .ch-head .tg-av.live::after { display: none; }
.tg-view.tg-view .ch-msgs { gap: 6px; padding: 10px 10px 8px; }
.tg-view.tg-view .msg .bub { position: relative; max-width: min(86%, 560px); padding: 7px 11px 8px; border-radius: 15px; font-size: 15.5px; line-height: 1.38;
  box-shadow: 0 1px 2px rgba(0,0,0,.18); border: 0; }
.tg-view.tg-view .msg.a .bub { max-width: min(92%, 640px); background: var(--tg-in); color: var(--tg-text); border-bottom-left-radius: 4px; padding: 7px 11px 8px; }
.tg-view.tg-view .msg.u .bub { background: var(--tg-out); color: var(--tg-out-text); border-bottom-right-radius: 4px; }
.tg-view.tg-view .msg.u .bub a { color: inherit; text-decoration: underline; }
.tg-view.tg-view .msg.a .bub a { color: var(--tg-primary); }
.tg-view.tg-view .msg .bub code { background: rgba(127,127,127,.18); }
.tg-view.tg-view .msg .bub pre { background: rgba(0,0,0,.22); }
.tg-view.tg-view .msg .mmeta, .tg-view .msg .pmeta { font-size: 12px; color: var(--tg-sub); margin-top: 2px; padding: 0 4px; text-shadow: 0 0 6px rgba(0,0,0,.25); }
.tg-view[data-tg-theme="light"] .msg .mmeta, .tg-view[data-tg-theme="light"] .msg .pmeta { color: rgba(0,0,0,.55); text-shadow: none; }
.tg-view.tg-view .msg.u .mmeta { color: var(--tg-out-meta); }
.tg-view[data-tg-theme="dark"] .msg.u .mmeta { color: rgba(255,255,255,.75); }
.tg-view.tg-view .msg.u .mmeta time::after { content: " \\2713\\2713"; letter-spacing: -3px; margin-left: 2px; color: var(--tg-check); }
.tg-view.tg-view .ch-compose { background: transparent; border-top: 0; padding: 6px 8px calc(8px + env(safe-area-inset-bottom, 0px)); }
.tg-view.tg-view .ch-compose textarea { background: var(--tg-compose); color: var(--tg-text); border: 0; border-radius: 22px; min-height: 46px; padding: 12px 16px; font: 400 16px var(--tg-font);
  box-shadow: 0 1px 2px rgba(0,0,0,.18); }
.tg-view.tg-view .ch-compose textarea:focus { border: 0; }
.tg-view.tg-view .ch-compose textarea::placeholder { color: var(--tg-sub); }
.tg-view.tg-view .ch-compose button { width: 46px; height: 46px; background: var(--tg-primary); box-shadow: 0 1px 2px rgba(0,0,0,.18); }
.tg-view.tg-view .ch-compose .ch-attach { background: var(--tg-compose); border: 0; }
.tg-view.tg-view .ch-compose .ch-attach svg { stroke: var(--tg-sub); }
`;

const esc = s => String(s ?? '');
function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
function initials(title) {
  const words = String(title || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return (words[0][0] + (words[1]?.[0] || '')).toUpperCase();
}
// The agent service dates a title that clashes with another chat's ("Vespa (14 Nov)"); Telegram shows the plain name.
export function cleanTitle(t) { return String(t || '').replace(/\s*\(\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?: \d{1,2}:\d{2})?(?: [^)]{1,12})?\)\s*$/, ''); }
function leadEmoji(title) { const m = String(title || '').match(/^\s*(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/u); return m ? m[1] : ''; }
function when(iso) {
  const t = Date.parse(iso || ''); if (!isFinite(t)) return '';
  const d = new Date(t), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (now - d < 6 * 864e5) return d.toLocaleDateString([], { weekday: 'short' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function svg(host, paths, cls) {
  const NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); if (cls) s.setAttribute('class', cls);
  for (const d of paths) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}
const ICON = {
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-4-4'],
  pencil: ['M4 20h4L19 9l-4-4L4 16v4z', 'M14 6l4 4'],
  archive: ['M4 7h16v3H4z', 'M5 10v9h14v-9', 'M10 14h4'],
  back: ['M15 5l-7 7 7 7'],
  tick2: ['M2 13l4 4 8-9', 'M10 15l2 2 8-9'],
  sweep: ['M20 4l-7.5 7.5', 'M10.5 10l3.5 3.5c-.8 3.4-3.2 6-6.5 7.5L3 20l1-4.5C5.5 12.2 7.6 10.4 10.5 10z', 'M7 15.5l2 2'],
  sparkle: ['M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z', 'M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z', 'M18 3v3', 'M16.5 4.5h3'],
};
function theme() {
  // Follow the shell, the same way its Appearance host decides: light skins get Telegram's day theme.
  const scheme = (getComputedStyle(document.documentElement).colorScheme || '').trim();
  return /\blight\b/.test(scheme) && !/\bdark\b/.test(scheme) ? 'light' : 'dark';
}
function avatar(host, s, small) {
  // A topic emoji on a soft tinted disc: the chat's subject at a glance, never a lone initial.
  const a = host.element('span'), [c1] = AVATARS[hash(s?.id || s?.title || '') % AVATARS.length];
  const e = leadEmoji(s?.title) || host.emoji?.(s) || '💬';
  a.className = 'tg-av emo' + (small ? ' sm' : '');
  a.style.background = `color-mix(in srgb, ${c1} 26%, transparent)`;
  a.textContent = e;
  return a;
}
// Notifications: the shell's own inbox (WosBell), the same items Chats lists. Read-only here; a tap opens one.
function notesOf(host) { try { return (host.notes?.items?.() || []).filter(i => i && i.id && !i.archived); } catch (_) { return []; } }
// The Notifications tab's number is every row it lists, read or not (telegram#33, Miguel, 20 Nov 2026). host.notes only
// holds Chats-routed items, so badge-only and Morning Report notifications stay out of it.
export function noteCount(host) { return notesOf(host).length; }
const notePlain = t => String(t || '').replace(/\[([^\]\n]+)\]\((https?:[^\s)]+)\)/g, '$1').replace(/[*`#>]/g, '').replace(/\s+/g, ' ').trim();
const noteTitle = it => notePlain(it.title) || notePlain(String(it.message || '').split('\n').find(l => l.trim())) || 'Notification';
const noteFrom = it => it.appName || it.fromName || it.app || it.from || 'Wizard';
function isWorking(s) { return WORKING.has(String(s?.status || '')); }
function needsYou(s) { return ['waiting_for_approval', 'unknown'].includes(s?.status) || s?.attention?.state === 'needs_you'; }
function failed(s) { return s?.status === 'failed' || s?.status === 'interrupted'; }
function stamp(host, s) { try { return host.live?.cardAt?.(s) || s.updatedAt || s.lastUserAt; } catch (_) { return s.updatedAt; } }
// The owner's Archive wins here: the shared rule keeps a working, failed or interrupted thread out of the archive
// even after he archived it, which made the button look like it did nothing. Only a thread waiting on him stays out.
function archived(host, s) { if (s && host.held?.(s.id)) return true; if (s?.archived && s.status !== 'waiting_for_approval') return true; try { return !!host.live?.inArchive?.(s); } catch (_) { return !!s.archived; } }

export default {
  contract: 'wizard.chats-view/1', id: 'tg-style', name: 'TG style',
  mount(el, host) {
    let folder = 'ready', query = '', inArchive = false, sig = '', searchFocus = false;
    mounted++;
    if (!document.getElementById(STYLE_ID)) { const st = host.element('style'); st.id = STYLE_ID; st.textContent = CSS; document.head.append(st); }
    el.classList.add('tg-view');
    const paintTheme = () => { el.dataset.tgTheme = theme(); };
    paintTheme();
    host.onAppearance(() => { paintTheme(); });

    const visible = () => host.threads.filter(s => !s.hidden);
    function pick() {
      const all = visible(), q = query.trim().toLowerCase();
      let rows = all.filter(s => archived(host, s) === inArchive);
      if (!inArchive && folder === 'ready') rows = rows.filter(s => !isWorking(s));
      if (!inArchive && folder === 'working') rows = rows.filter(isWorking);
      if (q) rows = all.filter(s => `${s.title || ''} ${s.preview || ''}`.toLowerCase().includes(q));
      const t = s => Date.parse(stamp(host, s)) || 0;
      return rows.sort((a, b) => t(b) - t(a));
    }
    function counts() {
      const live = visible().filter(s => !archived(host, s));
      // Switch ready-total: Ready's number is every chat in it, read or not (Miguel, 19 Nov 2026).
      const total = !!host.features?.['ready-total'];
      return { ready: live.filter(s => !isWorking(s) && (total || host.isUnread(s))).length, working: live.filter(isWorking).length,
        notes: noteCount(host), archive: visible().length - live.length };
    }
    function notes() {
      const t = i => Number(i.time) || 0;
      // ⌥ keys: only Wizard's own meanings, done here while this app is in front (⌥K search, ⌥N new chat, ⌥E archive).
      // Newest first, nothing else: reading one never moves it (Miguel, 15 Nov 2026).
      return notesOf(host).sort((a, b) => (t(b) - t(a)) || String(a.id).localeCompare(String(b.id)));
    }
    function noteRow(it) {
      const b = host.element('button'); b.type = 'button'; b.className = 'tg-row tg-note'; b.dataset.tgNote = it.id;
      if (!it.read) b.classList.add('unread');
      const av = host.element('span'); av.className = 'tg-av emo tg-note-av'; av.textContent = '\u{1F514}';
      const bd = host.element('span'); bd.className = 'tg-bd';
      const l1 = host.element('span'); l1.className = 'tg-l1';
      const name = host.element('b'); name.textContent = noteTitle(it); l1.append(name);
      const time = host.element('time'); time.textContent = it.time ? when(new Date(it.time * 1000).toISOString()) : ''; l1.append(time);
      const l2 = host.element('span'); l2.className = 'tg-l2';
      const pv = host.element('span'); const from = host.element('strong'); from.textContent = noteFrom(it) + ': ';
      pv.append(from, (it.source === 'cron' ? 'Scheduled job \u00b7 ' : '') + notePlain(it.message).slice(0, 160)); l2.append(pv);
      if (!it.read) { const x = host.element('i'); x.className = 'tg-badge ' + ((Number(it.priority) || 3) >= 4 ? 'at' : 'dot'); if ((Number(it.priority) || 3) >= 4) x.textContent = '!'; l2.append(x); }
      bd.append(l1, l2); b.append(av, bd);
      return b;
    }

    function row(s) {
      const b = host.element('button'); b.type = 'button'; b.className = 'tg-row'; b.dataset.chopen = s.id;
      const unread = host.isUnread(s), working = isWorking(s);
      if (unread) b.classList.add('unread');
      if (host.live?.isPrivate?.(s.id)) b.dataset.wizPrivate = '';
      const av = avatar(host, s); if (working) av.classList.add('live');
      const bd = host.element('span'); bd.className = 'tg-bd';
      const l1 = host.element('span'); l1.className = 'tg-l1';
      const name = host.element('b'); name.textContent = cleanTitle(s.title) || 'New chat';
      l1.append(name);
      if (working) l1.append(svg(host, ICON.tick2, 'tg-tick'));
      const time = host.element('time'); time.textContent = when(stamp(host, s)); l1.append(time);
      const l2 = host.element('span'); l2.className = 'tg-l2';
      const pv = host.element('span');
      // Switch newest-preview (telegram#1): the newest reply's summary, never an older pinned ask; open asks below.
      const info = host.rowInfo?.(s) || null;
      if (working) { const em = host.element('em'); em.textContent = 'typing…'; pv.append(em); }
      else if (info) { if (info.needs) { const st = host.element('strong'); st.textContent = 'Needs you: '; pv.append(st); } pv.append(info.preview || s.preview || ''); }
      else if (needsYou(s) && s.attention?.ask) { const st = host.element('strong'); st.textContent = 'Needs you: '; pv.append(st, s.attention.ask); }
      else pv.textContent = esc(s.attention?.ask || s.preview || '');
      l2.append(pv);
      // One rule: a badge means unread, and opening the chat clears it (its kind says why it matters).
      if (unread) { const x = host.element('i'); x.className = 'tg-badge ' + (failed(s) ? 'err' : needsYou(s) ? 'at' : 'dot'); x.textContent = failed(s) ? '!' : needsYou(s) ? '@' : ''; l2.append(x); }
      bd.append(l1, l2);
      if (info?.chip) {
        const ch = host.element('span'); ch.className = 'tg-askchip' + (info.chip.older ? ' older' : '');
        ch.dataset.tgAskjump = s.id; ch.dataset.mid = info.chip.mid || ''; ch.title = 'Go to this message';
        ch.textContent = info.chip.text; bd.append(ch);
      }
      b.append(av, bd);
      return b;
    }

    function list() {
      const c = counts(), noteMode = folder === 'notes' && !inArchive && !query.trim();
      const rows = noteMode ? [] : pick(), nts = noteMode ? notes() : [];
      const next = JSON.stringify([folder, query, inArchive, el.dataset.tgTheme, host.features || {}, !!host.sweepBusy?.(), !!host.catchupBusy?.(), nts.map(i => [i.id, i.read, i.title, i.time]), rows.map(s => [s.id, s.title, s.status, s.preview, s.attention?.state, s.attention?.ask, host.isUnread(s), stamp(host, s), host.rowInfo ? JSON.stringify(host.rowInfo(s)) : '']), c]);
      host.onCounts?.(c);
      if (next === sig && el.querySelector('.tg-list')) return;
      sig = next;
      const wrap = host.element('div'); wrap.className = 'tg-wrap';
      const root = host.element('div'); root.className = 'tg-list';
      const top = host.element('div'); top.className = 'tg-top';
      if (inArchive) {
        const back = host.element('button'); back.type = 'button'; back.className = 'tg-ibtn'; back.dataset.tgArchiveBack = ''; back.setAttribute('aria-label', 'Back'); back.append(svg(host, ICON.back));
        const h = host.element('h1'); h.textContent = 'Archived Chats'; top.append(back, h);
      } else {
        const h = host.element('h1'); h.textContent = 'Wizard Chats'; top.append(h);
        // Archive lives in the header, like Telegram's "Move to main menu": one quiet button, no count.
        // Switch ready-sweep: one tap opens a chat that works through the whole Ready list in chunks (Miguel, 19 Nov 2026).
        // Switch catch-me-up: Sweep becomes Catch me up, shown even when Ready is empty (other apps may still wait on him).
        if (host.features?.['catch-me-up'] && host.catchup && folder === 'ready' && !query.trim()) {
          const cu = host.element('button'), busy = !!host.catchupBusy?.(); cu.type = 'button'; cu.className = 'tg-sweep tg-catchup' + (busy ? ' busy' : ''); cu.dataset.tgCatchup = '';
          cu.disabled = busy; cu.setAttribute('aria-busy', String(busy));
          cu.title = busy ? 'Your catch-up is running; it lands in Ready when it is done' : 'Everything waiting on you across your apps, fresh each time';
          cu.append(svg(host, ICON.sparkle), busy ? 'Catching up…' : 'Catch me up');
          if (busy) { const sp = host.element('span'); sp.className = 'tg-spin'; sp.setAttribute('aria-hidden', 'true'); cu.append(sp); }
          top.append(cu);
        } else if (host.features?.['ready-sweep'] && host.sweep && folder === 'ready' && !query.trim() && rows.length) {
          const sw = host.element('button'), busy = !!host.sweepBusy?.(); sw.type = 'button'; sw.className = 'tg-sweep' + (busy ? ' busy' : ''); sw.dataset.tgSweep = '';
          sw.disabled = busy; sw.setAttribute('aria-busy', String(busy));
          sw.title = busy ? 'Starting your sweep…' : `Work through all ${rows.length} Ready chats with your agent`;
          sw.append(svg(host, ICON.sweep), busy ? 'Sweeping…' : 'Sweep'); top.append(sw);
        }
        if (c.archive) { const ab = host.element('button'); ab.type = 'button'; ab.className = 'tg-ibtn'; ab.dataset.tgArchive = ''; ab.title = 'Archived Chats'; ab.setAttribute('aria-label', 'Archived Chats'); ab.append(svg(host, ICON.archive)); top.append(ab); }
      }
      root.append(top);
      const sb = host.element('label'); sb.className = 'tg-search';
      const input = host.element('input'); input.type = 'search'; input.placeholder = 'Search'; input.value = query; input.dataset.tgSearch = ''; input.setAttribute('aria-label', 'Search chats'); input.dataset.wzKey = 'k'; input.title = 'Search (⌥K)'; input.dataset.wzKeyLabel = 'Search';
      sb.append(svg(host, ICON.search), input); root.append(sb);
      if (!inArchive && !query) {
        const tabs = host.element('div'); tabs.className = 'tg-tabs'; tabs.setAttribute('role', 'tablist');
        for (const [id, label] of FOLDERS) {
          const t = host.element('button'); t.type = 'button'; t.className = 'tg-tab'; t.dataset.tgFolder = id; t.setAttribute('role', 'tab');
          t.setAttribute('aria-selected', String(folder === id)); const lb = host.element('span'); lb.textContent = label; t.append(lb);
          // Switch ready-total: the Ready tab shows its total, every chat in it read or not (Miguel, 20 Nov 2026); the same
          // number also rides on the app's badge while the app is open.
          const n = id === 'ready' ? c.ready : id === 'working' ? c.working : id === 'notes' ? c.notes : 0;
          if (n) { const i = host.element('i'); i.textContent = String(n); t.append(i); }
          tabs.append(t);
        }
        root.append(tabs);
      }
      const sc = host.element('div'); sc.className = 'tg-scroll';
      for (const s of rows) sc.append(row(s));
      for (const it of nts) sc.append(noteRow(it));
      if (noteMode && !nts.length) {
        const e = host.element('div'); e.className = 'tg-empty'; const b = host.element('b'); b.textContent = 'No notifications';
        e.append(b, 'Alerts and scheduled updates show up here.'); sc.append(e);
      } else if (!noteMode && !rows.length) {
        const e = host.element('div'); e.className = 'tg-empty'; const b = host.element('b');
        b.textContent = query ? 'No results' : folder === 'working' ? 'Nothing running' : folder === 'ready' ? 'All caught up' : 'No chats yet';
        e.append(b, query ? 'Try another word.' : 'Tap the pencil to start one.'); sc.append(e);
      }
      root.append(sc);
      const fab = host.element('button'); fab.type = 'button'; fab.className = 'tg-fab'; fab.dataset.chnew = ''; fab.setAttribute('aria-label', 'New chat'); fab.dataset.wzKey = 'n'; fab.title = 'New chat (⌥N)'; fab.append(svg(host, ICON.pencil));
      // The pencil always shows, on phone and desktop (Miguel, 18 Nov 2026); a folded narrow list hides it via CSS.
      wrap.append(root, fab);
      const keep = el.querySelector('.tg-scroll')?.scrollTop || 0;
      el.replaceChildren(wrap);
      sc.scrollTop = keep;
      if (searchFocus) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }

    function dressThread() {
      const head = el.querySelector('.ch-head'); if (!head) return;
      const s = host.thread ? (host.live?.session?.(host.thread) || null) : null;
      const ti = head.querySelector('.ti');
      if (ti && !head.querySelector(':scope > .tg-av')) ti.before(avatar(host, s || { title: ti.textContent, id: host.thread || '' }, true));
      if (ti) {
        let sub = ti.querySelector('.tg-sub');
        if (!sub) { sub = host.element('span'); sub.className = 'tg-sub'; ti.append(sub); }
        const working = isWorking(s);
        sub.textContent = working ? 'typing…' : needsYou(s) ? 'needs you' : failed(s) ? 'something went wrong' : 'online';
        sub.classList.toggle('on', working);
      }
    }

    const update = () => {
      paintTheme();
      if (host.thread) { sig = ''; host.renderDefault(); dressThread(); return; }
      list();
    };

    host.listen('click', e => {
      // An open-ask chip sits inside its row: jump to that message instead of only opening the chat.
      const j = e.target.closest('[data-tg-askjump]');
      if (j && host.jumpTo) { e.preventDefault(); e.stopImmediatePropagation(); host.jumpTo(j.dataset.tgAskjump, j.dataset.mid); return; }
      if (e.target.closest('[data-tg-catchup]')) { e.preventDefault(); e.stopImmediatePropagation(); host.catchup?.(pick()); return; }
      if (e.target.closest('[data-tg-sweep]')) { e.preventDefault(); e.stopImmediatePropagation(); host.sweep?.(pick()); return; }
      const f = e.target.closest('[data-tg-folder]');
      if (f) { folder = f.dataset.tgFolder; list(); return; }
      const n = e.target.closest('[data-tg-note]'); if (n) { host.notes?.open?.(n.dataset.tgNote); return; }
      if (e.target.closest('[data-tg-archive]')) { inArchive = true; list(); return; }
      if (e.target.closest('[data-tg-archive-back]')) { inArchive = false; list(); return; }
      // Outside a Chats window (the desktop AI apps sidebar, wizard-ux issue 1443) no shell window handler sees our
      // rows' taps, so a row opens through the contract: the shell routes it to the main chat (Miguel, 17 Nov 2026).
      if (el.closest('.win')) return;
      const row = e.target.closest('[data-chopen]');
      if (row) { e.stopPropagation(); host.openThread(row.dataset.chopen); }
    });
    host.listen('input', e => {
      if (!e.target.matches?.('[data-tg-search]')) return;
      query = e.target.value; searchFocus = true; list();
    });
    host.listen('focusout', e => { if (e.target.matches?.('[data-tg-search]')) searchFocus = false; });
    host.listen('keydown', e => {
      if (e.key === 'Escape' && e.target.matches?.('[data-tg-search]') && query) { query = ''; searchFocus = false; list(); }
    });
    host.subscribe(update);
    let notesOff = null;
    try { notesOff = host.notes?.watch?.(() => { if (!host.thread) list(); }) || null; } catch (_) {}

    return {
      update,
      unmount() {
        sig = ''; el.classList.remove('tg-view'); delete el.dataset.tgTheme;
        try { notesOff?.(); } catch (_) {}
        mounted = Math.max(0, mounted - 1);
        if (!mounted) document.getElementById(STYLE_ID)?.remove();
      },
    };
  },
};
