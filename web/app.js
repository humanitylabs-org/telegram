// Telegram as a normal app window. The chat list is tg-view.js; threads, sending, uploads, voice, live replies and
// approvals all go through the shell's own engine on the parent page (same origin), so this page keeps no
// messages, tokens or model logic of its own.
import view from './tg-view.js';

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
  return { ...m, text: strip(h.text), files: (h.attachments || []).filter(a => !inline.has(a.url)) };
}
function md(text) {
  try { if (KIT?.md) return KIT.md(text); } catch (_) {}
  return esc(text).replace(/\n/g, '<br>');
}
function fileHtml(f) {
  const mime = String(f.mime || '');
  if (mime.startsWith('image/')) return `<a class="tg-img" href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" alt="${esc(f.name)}" loading="lazy"></a>`;
  if (mime.startsWith('audio/') || /^wizard-voice-/.test(f.name || '')) return `<div class="tg-voice"><audio controls preload="none" src="${esc(f.url)}"></audio></div>`;
  return `<a class="tg-file" href="${esc(f.url)}" target="_blank" rel="noopener"><i>📄</i><span>${esc(f.name)}</span></a>`;
}

function start() {
  let thread = null, instance = null, msgs = [], msgSig = '', loading = false, sending = false, draft = '';
  let tray = [], stream = null, streamSnap = null, approval = null, apKey = '', rec = null, recT = null, menu = null;
  const listen = (type, fn, target = root) => target.addEventListener(type, e => { try { fn(e); } catch (err) { console.error(err); } });
  const host = {
    contract: 'wizard.chats-view/1', windowId: 'telegram-app', region: 'main',
    get thread() { return thread; },
    get threads() { return (LIVE.sessions || []).filter(s => !s.hidden && !LIVE.agentOf?.(s.id)); },
    live: LIVE,
    isUnread: s => !!LIVE.isNew?.(s),
    emoji: s => { try { return P.WosTopicEmoji?.get(`thread:${s.id}`, [s.attention?.subject, s.title, s.preview].filter(Boolean).join(' ')); } catch (_) { return ''; } },
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
  };
  instance = view.mount(root, host);
  instance.update();

  /* ---------- events ---------- */
  listen('click', e => {
    if (menu && !e.target.closest('.tg-menu')) closeMenu();
    const mi = e.target.closest('[data-tg-menu]'); if (mi) { menuAct(mi.dataset.tgMenu, mi.dataset.id); return; }
    if (e.target.closest('.tg-menu')) return;
    const row = e.target.closest('[data-chopen]'); if (row) { open(row.dataset.chopen); return; }
    if (e.target.closest('[data-chnew]')) { open('__new__'); return; }
    if (e.target.closest('[data-tg-back]')) { close(); return; }
    if (e.target.closest('[data-tg-attach]')) { root.querySelector('#tg-file')?.click(); return; }
    const x = e.target.closest('[data-tg-unattach]'); if (x) { tray = tray.filter(f => f.key !== x.dataset.tgUnattach); paintTray(); syncSend(); return; }
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
  listen('input', e => {
    if (!e.target.matches?.('.ch-compose textarea')) return;
    draft = e.target.value; e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 180) + 'px'; syncSend();
  });
  listen('change', e => { if (e.target.id === 'tg-file' && e.target.files?.length) { addFiles([...e.target.files]); e.target.value = ''; } });
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
    instance.update(); focusComposer();
  }
  function close() { recCancel(); unfollow(); thread = null; msgs = []; msgSig = ''; approval = null; instance.update(); }
  async function load() {
    if (loading || !thread || thread === '__new__') return;
    loading = true; const id = thread;
    try {
      const rows = await LIVE.messages(id);
      if (thread !== id) return;
      msgs = rows.filter(m => m.role === 'user' || m.role === 'assistant').map(shape).filter(m => m.text || m.files.length);
      const sig = msgs.length + ':' + (msgs.at(-1)?.id || '') + ':' + (LIVE.session(id)?.status || '') + ':' + (LIVE.session(id)?.title || '');
      if (sig !== msgSig) { msgSig = sig; paintThread(); }
    } catch (e) { console.error(e); }
    finally { loading = false; }
  }
  // Live reply: the shell's own run stream, word by word, with the tool that is running.
  function follow() {
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
  function menuAct(act, id) {
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
      upload(file).then(f => { Object.assign(t, f, { uploading: false }); paintTray(); syncSend(); },
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
      paintComposer();
      await deliver((out.text || '').trim() || '🎤 Voice message', [f.id]);
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
    catch (e) { tray = sent; draft = text; paintThread(); showErr(e.message || 'Could not send'); }
  }
  async function deliver(text, fileIds = []) {
    if (sending) throw new Error('Still sending the last message');
    sending = true;
    msgs.push({ id: 'pending', role: 'user', text, files: [], timestamp: Date.now() / 1000, pending: true }); paintThread();
    try {
      const opts = fileIds.length ? { fileIds } : {};
      if (thread === '__new__') { const r = await LIVE.send(text, opts); thread = r.sessionId; }
      else await LIVE.reply(thread, text, opts);
      msgSig = ''; setTimeout(() => { load(); follow(); }, 700);
    } catch (e) { msgs = msgs.filter(m => m.id !== 'pending'); paintThread(); throw e; }
    finally { sending = false; }
  }
  function showErr(text) { const err = root.querySelector('.tg-err'); if (err) { err.textContent = text; setTimeout(() => { if (err.textContent === text) err.textContent = ''; }, 6000); } else console.warn(text); }
  function focusComposer() { const ta = root.querySelector('.ch-compose textarea'); if (ta && matchMedia('(pointer: fine)').matches) ta.focus(); }
  // Telegram's one round button: a mic while the box is empty, Send once there is something to send.
  function syncSend() {
    const b = root.querySelector('form.ch-compose .tg-sendbtn'); if (!b) return;
    const has = !!(root.querySelector('.ch-compose textarea')?.value.trim() || tray.length);
    b.dataset.mode = has ? 'send' : 'mic';
    b.toggleAttribute('data-tg-send', has); b.toggleAttribute('data-tg-mic', !has);
    b.setAttribute('aria-label', has ? 'Send' : 'Record a voice message');
  }

  /* ---------- painting ---------- */
  const ICON_BTN = '<svg viewBox="0 0 24 24" class="i-send"><path d="M4 12l16-8-6 16-2-7z"/></svg><svg viewBox="0 0 24 24" class="i-mic"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path class="ln" d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  function composerHtml(busy) {
    if (rec) return `<div class="ch-compose tg-recbar"><button type="button" class="tg-rec-x" data-tg-rec-cancel aria-label="Cancel">✕</button><span class="tg-rec-dot"></span><span class="tg-rec-time">0:00</span><span class="tg-rec-hint">Recording…</span><button type="button" class="tg-sendbtn" data-mode="send" data-tg-rec-send aria-label="Send voice message">${ICON_BTN}</button></div>`;
    if (busy) return `<div class="ch-compose tg-recbar"><em class="tg-spin"></em><span class="tg-rec-hint">Sending voice message…</span></div>`;
    return `<div class="tg-tray" hidden></div><form class="ch-compose"><button type="button" class="ch-attach" data-tg-attach aria-label="Attach a file"><svg viewBox="0 0 24 24"><path d="M21 12.5l-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.3-8.3"/></svg></button><textarea rows="1" placeholder="Message" aria-label="Message">${esc(draft)}</textarea><button type="button" class="tg-sendbtn" data-mode="mic" data-tg-mic aria-label="Record a voice message">${ICON_BTN}</button></form><input type="file" id="tg-file" multiple hidden>`;
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
    return `<div class="msg a tg-live"><div class="bub"><div class="tg-text">${md(text)}</div>${stepLine ? `<div>${stepLine}</div>` : ''}</div></div>`;
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
  function paintThread() {
    if (!thread) return;
    const s = thread !== '__new__' ? LIVE.session(thread) : null;
    const old = root.querySelector('.ch-msgs');
    const keepBottom = !old || old.scrollHeight - old.scrollTop - old.clientHeight < 80, prevTop = old?.scrollTop || 0;
    const ta0 = root.querySelector('.ch-compose textarea'), typing = ta0 && document.activeElement === ta0, sel = typing ? [ta0.selectionStart, ta0.selectionEnd] : null;
    if (ta0) draft = ta0.value;
    const answer = root.querySelector('.tg-ap-answer')?.value || '';
    let lastDay = '', body = '';
    for (const m of msgs) {
      const d = day(m.timestamp); if (d && d !== lastDay) { body += `<div class="tg-day"><span>${esc(d)}</span></div>`; lastDay = d; }
      const u = m.role === 'user';
      const files = (m.files || []).map(fileHtml).join('');
      const hide = files && ['🎤 Voice message', '📎'].includes(m.text);
      const text = m.text && !hide ? (u ? esc(m.text).replace(/\n/g, '<br>') : md(m.text)) : '';
      body += `<div class="msg ${u ? 'u' : 'a'}${m.pending ? ' pending' : ''}"><div class="bub">${files}${text ? `<div class="tg-text">${text}</div>` : ''}<span class="mmeta"><time>${esc(clock(m.timestamp))}</time></span></div></div>`;
    }
    body += liveHtml();
    if (!body) body = thread === '__new__' ? '<div class="tg-day"><span>New chat with your Wizard</span></div>' : '<div class="tg-day"><span>Loading…</span></div>';
    const working = s && WORKING.has(s.status);
    const status = working ? 'typing…' : s?.status === 'waiting_for_approval' ? 'waiting for you' : 'online';
    root.innerHTML = `<div class="ch-thread">
      <div class="ch-head"><button type="button" class="ch-back" data-tg-back aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><span class="tg-av emo sm"></span><div class="ti" data-tg-title title="Tap to rename"><b>${esc(s?.title || 'New chat')}</b><span class="tg-sub${working ? ' on' : ''}">${status}</span></div>${working ? '<button type="button" class="tg-stop" data-tg-stop aria-label="Stop" title="Stop">■</button>' : ''}</div>
      <div class="ch-msgs">${body}</div>
      ${approvalHtml()}
      <p class="tg-err" role="status"></p>
      <div class="tg-composer">${composerHtml(false)}</div>
    </div>`;
    const av = root.querySelector('.ch-head .tg-av');
    av.textContent = host.emoji(s || { id: thread, title: 'New chat' }) || '💬';
    av.style.background = 'color-mix(in srgb, var(--tg-primary) 22%, transparent)';
    const ans = root.querySelector('.tg-ap-answer'); if (ans) ans.value = answer;
    const m = root.querySelector('.ch-msgs'); m.scrollTop = keepBottom ? m.scrollHeight : prevTop;
    paintTray(); syncSend();
    if (typing) { const ta = root.querySelector('.ch-compose textarea'); ta.focus({ preventScroll: true }); ta.setSelectionRange(...sel); }
  }
}
