// Chat list preview with open asks (switch newest-preview, humanitylabs-org/telegram#1). Off by default.
// The row's preview line is the newest reply's own status ask (its one-line summary), so it matches what the
// owner sees on opening the thread. Asks still waiting on the owner get their own chip under it, never in place
// of it: from the thread tracker items when the box keeps them, else from the replies' own status lines.
// Pure functions only: app.js fetches the thread and its tracker items and hands them in.

const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const MARKER = /\[WIZARD_STATUS_V1\]\s*([\s\S]*?)\s*\[\/WIZARD_STATUS_V1\]/;
const textOf = c => Array.isArray(c) ? c.map(p => typeof p === 'string' ? p : p?.text || '').join('') : String(c ?? '');
// Seconds, whatever the box sent (epoch seconds, epoch ms or an ISO string); NaN when unknown.
export const secs = v => { const n = typeof v === 'number' ? v : Number(v); if (Number.isFinite(n) && String(v).trim() !== '') return n > 1e11 ? n / 1000 : n; return Date.parse(String(v ?? '')) / 1000; };
const midOf = r => String(r?.id ?? r?.message_id ?? '');

// A reply's status: the Agent Service puts it on the row (wizard_state / wizard_ask); older boxes leave the marker.
export function statusOf(row) {
  let state = typeof row?.wizard_state === 'string' ? row.wizard_state : '', ask = typeof row?.wizard_ask === 'string' ? row.wizard_ask : '';
  if (!state || !ask) {
    const m = textOf(row?.content ?? row?.text).match(MARKER);
    try { const j = m && JSON.parse(m[1]); if (j && typeof j === 'object') { state ||= String(j.state || ''); ask ||= String(j.ask || ''); } } catch (_) { /* not a status */ }
  }
  return { state: clean(state).toLowerCase(), ask: clean(ask).slice(0, 280) };
}

const talk = rows => (Array.isArray(rows) ? rows : []).filter(r => r && (r.role === 'user' || r.role === 'assistant'));

// The newest reply (the last assistant row, whatever came after it): { mid, text, state }, or null with none.
export function newestReply(rows) {
  const r = talk(rows).filter(x => x.role === 'assistant').at(-1);
  if (!r) return null;
  const st = statusOf(r);
  return { mid: midOf(r), text: st.ask, state: st.state };
}

// Asks still waiting on the owner, oldest first: { mid, text, at, older }.
// Tracker items (the box's ledger) win when there are any: an item is open while its latest state is needs_you and
// the owner has not dismissed it; a later reply marking it done (or dropped, which the box records as done) clears it.
// Without items: the newest needs_you reply is open until a later reply says done or asks something newer.
// An ask the owner has written past twice (2+ messages after it, none answering it) is marked older.
export function openAsks(rows, items) {
  const all = talk(rows);
  let open = [];
  const tracked = Array.isArray(items) ? items.filter(i => i && i.id && i.state) : [];
  if (tracked.length) {
    open = tracked.filter(i => i.state === 'needs_you' && !i.seen)
      .map(i => ({ mid: String(i.message_id ?? ''), text: clean(i.ask || i.summary || i.title).slice(0, 280), at: secs(i.at ?? i.updated_at) }));
  } else {
    let pending = null;
    for (const r of all) {
      if (r.role !== 'assistant') continue;
      const st = statusOf(r);
      if (st.state === 'needs_you' && st.ask) pending = { mid: midOf(r), text: st.ask, at: secs(r.timestamp ?? r.created_at) };
      else if (st.state === 'done') pending = null;
    }
    if (pending) open = [pending];
  }
  const userAts = all.filter(r => r.role === 'user').map(r => secs(r.timestamp ?? r.created_at)).filter(Number.isFinite);
  return open.filter(a => a.text)
    .map(a => ({ ...a, older: Number.isFinite(a.at) && userAts.filter(t => t > a.at).length >= 2 }))
    .sort((a, b) => (Number.isFinite(a.at) ? a.at : 0) - (Number.isFinite(b.at) ? b.at : 0));
}

// What one list row shows: { preview, needs, asks }. An ask that is the newest reply itself is already the preview,
// so it gets no chip.
export function rowInfo(rows, items) {
  const newest = newestReply(rows);
  const asks = openAsks(rows, items).filter(a => !newest || !a.mid || a.mid !== newest.mid);
  return { preview: newest?.text || '', needs: newest?.state === 'needs_you' && !!newest.text, asks };
}

// The chip's words: "1 waiting: Reply go to run the test" (the oldest open ask), or "Older ask: …" once dimmed.
export function chipText(asks) {
  if (!asks?.length) return '';
  const a = asks[0];
  return a.older && asks.length === 1 ? `Older ask: ${a.text}` : `${asks.length} waiting: ${a.text}`;
}
