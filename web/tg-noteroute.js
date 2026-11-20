// Where an opened notification's app sends its notifications (humanitylabs-org/wizard-os#766): the shell's own
// picker (WosBell.picker: Chats · Badge · Morning report · Off, whatever the routing part offers), the one saved
// route Settings > Notifications and the built-in Chats also write, with the shell's Undo toast (WosBell.movedToast).
// Pure functions only: app.js hands in the parent's WosBell and the shell's toast.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The "Messenger notifications go to" line and the picker, or '' when the shell has no picker (older shells).
export function routeHtml(B, src) {
  if (!src?.id || typeof B?.picker !== 'function') return '';
  let pick = '';
  try { pick = String(B.picker(src.id, { name: src.name }) || ''); } catch (_) { return ''; }
  if (!pick) return '';
  let ask = '';
  try { ask = String(B.ask?.(src.id, src.name) || ''); } catch (_) { /* stock wording below */ }
  return `<div class="tg-note-route" data-part="notify-route"><span>${esc(ask || `${src.name} notifications go to`)}</span>${pick}</div>`;
}

// Picked `to` for source `id`. Saves it through the shell; anywhere but Chats takes the source's items out of
// Chats, so the caller drops them and closes the note, and the shell's toast offers Undo.
// Returns { ok, changed, from, leaves, undo } (undo: the shell showed its Undo toast).
export function pickRoute(B, id, to, shellToast) {
  id = String(id || ''); to = String(to || '');
  if (!id || !to || typeof B?.setRoute !== 'function') return { ok: false, changed: false, from: '', leaves: false, undo: false };
  let from = '';
  try { from = String(B.route?.(id) || ''); } catch (_) { /* unknown */ }
  if (from && from === to) return { ok: true, changed: false, from, leaves: false, undo: false };
  let ok = false;
  try { ok = !!B.setRoute(id, to); } catch (_) { ok = false; }
  if (!ok) return { ok: false, changed: false, from, leaves: false, undo: false };
  const leaves = to !== 'chats';
  let undo = false;
  if (leaves && typeof shellToast === 'function' && typeof B.movedToast === 'function') {
    try { undo = !!B.movedToast(id, shellToast, 5000, from || 'chats'); } catch (_) { undo = false; }
  }
  return { ok: true, changed: true, from, leaves, undo };
}
