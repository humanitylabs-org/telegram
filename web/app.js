// Telegram as a normal app window. The chat list is the same Telegram view the Chats slot uses (tg-view.js);
// threads, sending and live updates go through the shell's own chat engine (window.parent.WizLive), so this page
// keeps no messages, tokens or model logic of its own. Needs the Wizard shell as its parent on the same origin.
import view from './tg-view.js';

const root = document.getElementById('tg-root');
const shell = (() => { try { return window.parent !== window && window.parent.WizLive ? window.parent : null; } catch (_) { return null; } })();
const LIVE = shell?.WizLive;
const WORKING = new Set(['submitting', 'queued', 'running', 'stopping']);

function unavailable(text) {
  root.innerHTML = `<div class="tg-off"><b>Open Telegram from Wizard</b><p>${text}</p></div>`;
}
if (!LIVE) unavailable('This window shows your Wizard chats, so it needs to be opened inside Wizard on this box.');
else start();

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
// Small, safe Markdown: code blocks, inline code, bold, italics, links, line breaks.
function md(text) {
  const parts = String(text || '').split(/```[a-zA-Z0-9_-]*\n?/);
  return parts.map((p, i) => {
    if (i % 2) return `<pre><code>${esc(p.replace(/\n$/, ''))}</code></pre>`;
    let h = esc(p);
    h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, '$1<i>$2</i>')
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
      .replace(/^MEDIA:\S+$/gm, '<i class="tg-media">📎 attachment</i>')
      .replace(/\[WIZARD_STATUS_V1\][\s\S]*?\[\/WIZARD_STATUS_V1\]/g, '')
      .replace(/\n/g, '<br>');
    return h;
  }).join('');
}
function clock(ts) {
  const d = new Date(typeof ts === 'number' ? ts * 1000 : ts);
  return isFinite(d) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
}
function day(ts) {
  const d = new Date(typeof ts === 'number' ? ts * 1000 : ts), now = new Date();
  if (!isFinite(d)) return '';
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === new Date(now - 864e5).toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'long', day: 'numeric' });
}

function start() {
  let thread = null, instance = null, msgs = [], msgSig = '', loading = false, sending = false, draft = '';
  const offs = new Set();
  const listen = (type, fn) => { const cb = e => { try { fn(e); } catch (err) { console.error(err); } }; root.addEventListener(type, cb); offs.add(() => root.removeEventListener(type, cb)); };
  const host = {
    contract: 'wizard.chats-view/1', windowId: 'telegram-app', region: 'main',
    get thread() { return thread; },
    get threads() { return (LIVE.sessions || []).filter(s => !s.hidden && !LIVE.agentOf?.(s.id)); },
    live: LIVE,
    isUnread: s => !!LIVE.isNew?.(s),
    openThread: id => open(id),
    back: () => close(),
    renderDefault: () => paintThread(),
    element: tag => document.createElement(tag),
    listen,
    subscribe: fn => { const off = LIVE.onChange(() => { try { fn(); } catch (e) { console.error(e); } }); offs.add(off); return off; },
    onAppearance: fn => { const o = new MutationObserver(() => fn()); o.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-skin', 'data-color-scheme', 'class'] }); return () => o.disconnect(); },
    toast: (_icon, text) => console.log(text),
  };
  instance = view.mount(root, host);
  instance.update();

  // Rows and the pencil carry the shell's own data attributes; in a normal window this page handles them.
  listen('click', e => {
    const row = e.target.closest('[data-chopen]'); if (row) { open(row.dataset.chopen); return; }
    if (e.target.closest('[data-chnew]')) { open('__new__'); return; }
    if (e.target.closest('[data-tg-back]')) close();
  });
  listen('keydown', e => {
    if (e.target.matches?.('.ch-compose textarea') && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    if (e.key === 'Escape' && thread && !e.target.matches?.('[data-tg-search]')) close();
  });
  listen('input', e => {
    if (!e.target.matches?.('.ch-compose textarea')) return;
    draft = e.target.value; e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 180) + 'px';
  });
  listen('submit', e => { if (e.target.closest('.ch-compose')) { e.preventDefault(); send(); } });

  // Keep an open thread live: re-read when its row changes, and every few seconds while it is working.
  LIVE.onChange(() => { if (thread && thread !== '__new__') load(); });
  setInterval(() => { const s = thread && LIVE.session(thread); if (s && WORKING.has(s.status)) load(); }, 3000);

  function open(id) {
    thread = id; msgs = []; msgSig = ''; draft = '';
    if (id !== '__new__') { try { LIVE.markSeen?.(id); } catch (_) {} load(); }
    instance.update();
    focusComposer();
  }
  function close() { thread = null; msgs = []; msgSig = ''; instance.update(); }
  async function load() {
    if (loading || !thread || thread === '__new__') return;
    loading = true; const id = thread;
    try {
      const rows = await LIVE.messages(id);
      if (thread !== id) return;
      msgs = rows.filter(m => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim());
      const sig = msgs.length + ':' + (msgs.at(-1)?.id || '') + ':' + (LIVE.session(id)?.status || '');
      if (sig !== msgSig) { msgSig = sig; instance.update(); }
    } catch (e) { console.error(e); }
    finally { loading = false; }
  }
  async function send() {
    const ta = root.querySelector('.ch-compose textarea'); const text = (ta?.value || '').trim();
    if (!text || sending) return;
    sending = true; draft = ''; if (ta) { ta.value = ''; ta.style.height = ''; }
    msgs.push({ id: 'pending', role: 'user', content: text, timestamp: Date.now() / 1000, pending: true }); paintThread();
    try {
      if (thread === '__new__') { const r = await LIVE.send(text); thread = r.sessionId; }
      else await LIVE.reply(thread, text);
      msgSig = ''; setTimeout(load, 800);
    } catch (e) {
      msgs = msgs.filter(m => m.id !== 'pending'); draft = text; paintThread();
      const err = root.querySelector('.tg-err'); if (err) err.textContent = e.message || 'Could not send';
    } finally { sending = false; }
  }
  function focusComposer() { const ta = root.querySelector('.ch-compose textarea'); if (ta && matchMedia('(pointer: fine)').matches) ta.focus(); }

  function paintThread() {
    const s = thread && thread !== '__new__' ? LIVE.session(thread) : null;
    const keepBottom = (() => { const m = root.querySelector('.ch-msgs'); return !m || m.scrollHeight - m.scrollTop - m.clientHeight < 80; })();
    const prevTop = root.querySelector('.ch-msgs')?.scrollTop || 0;
    const ta0 = root.querySelector('.ch-compose textarea'), typing = ta0 && document.activeElement === ta0, sel = typing ? [ta0.selectionStart, ta0.selectionEnd] : null;
    let lastDay = '', body = '';
    for (const m of msgs) {
      const d = day(m.timestamp); if (d && d !== lastDay) { body += `<div class="tg-day"><span>${esc(d)}</span></div>`; lastDay = d; }
      const u = m.role === 'user';
      body += `<div class="msg ${u ? 'u' : 'a'}${m.pending ? ' pending' : ''}"><div class="bub">${u ? esc(m.content).replace(/\n/g, '<br>') : md(m.content)}<span class="mmeta"><time>${esc(clock(m.timestamp))}</time></span></div></div>`;
    }
    if (s && WORKING.has(s.status)) body += `<div class="msg a"><div class="bub tg-typing"><i></i><i></i><i></i></div></div>`;
    if (!msgs.length) body += thread === '__new__' ? `<div class="tg-day"><span>New chat with your Wizard</span></div>` : loading || msgSig === '' ? `<div class="tg-day"><span>Loading…</span></div>` : '';
    root.innerHTML = `<div class="ch-thread">
      <div class="ch-head"><button type="button" class="ch-back" data-tg-back aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><div class="ti"><b>${esc(s?.title || 'New chat')}</b></div></div>
      <div class="ch-msgs">${body}</div>
      <p class="tg-err" role="status"></p>
      <form class="ch-compose"><textarea rows="1" placeholder="Message" aria-label="Message">${esc(draft)}</textarea><button type="submit" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-2-7z"/></svg></button></form>
    </div>`;
    const m = root.querySelector('.ch-msgs'); m.scrollTop = keepBottom ? m.scrollHeight : prevTop;
    if (typing) { const ta = root.querySelector('.ch-compose textarea'); ta.focus({ preventScroll: true }); ta.setSelectionRange(...sel); }
  }
}
