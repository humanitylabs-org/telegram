// Catch me up (switch catch-me-up, telegram#7). A tap starts a fresh catch-up chat in the background (the owner stays
// in the list); the pill keeps its spinner while that chat is running and a second tap never starts another run.
// The chat lands in Ready on its own once the overview is done. Pure functions so they can be tested without the shell.

export const WORKING = new Set(['submitting', 'queued', 'running', 'stopping']);
// Between the send and the chat showing up in the live list, the run counts as running for this long.
export const START_GRACE_MS = 90000;

// last: { id, at } saved when the catch-up started (or null); session: LIVE.session(last.id) (or null).
export function catchupRunning(last, session, now = Date.now()) {
  if (!last || !last.id) return false;
  if (!session) return now - (Number(last.at) || 0) < START_GRACE_MS;
  if (session.archived) return false;
  return WORKING.has(String(session.status || ''));
}

export function catchupMessage(cu) {
  const n = cu.chats | 0, a = cu.notifications | 0;
  return {
    text: `\u2728 Catch me up (${cu.catchup_id})`,
    instructions: `Catch me up from the TG style app. Load the tg-style skill and follow its Catch me up section. `
      + `Start with the tg-style app's catchup_list tool (mcp__wizard__tg_style__catchup_list), catchup_id ${cu.catchup_id}; `
      + `it has ${n} Ready chat(s) and ${a} unread notification(s). Then check the owner's other installed apps as the skill says. `
      + `This is a fresh pull: say nothing about earlier catch-ups. `
      + `Write it in the skill's fixed phone layout (## heading, app table, ### A/B/C/D sections, one bold card per item), even if your persona avoids headings.`,
  };
}
