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
      + `it has ${n} Ready chat(s) and ${a} unread notification(s). Those are the only notifications to cover (what his routing sends to Chats): `
      + `never read the Notifications app's own inbox or report its unread count. Then check the owner's other installed apps as the skill says. `
      + `This is a fresh pull: say nothing about earlier catch-ups. `
      + `Write it one app per message as the skill says (Miguel, 20 Nov 2026): order Messenger, Mail, WizardOS Tracker, Card Benefits, `
      + `Money/Finances, Second Hand, Wizard chats and notifications last; skip apps with nothing and count only the rest. `
      + `Every app message starts with a progress line like **2 of 5 · Mail** · Still to do: Tracker, Second Hand (the last one says · Last one), `
      + `and every back-and-forth reply inside an app ends with the same line. Show only the first app now; the next one only after he finishes it. `
      + `Messenger is one message: first save a draft (messenger_create_draft, in the chat's language) for every chat that needs a reply from him, `
      + `then list the names you drafted for and one line: → [Open Messenger](/messenger/), then send, edit or skip each draft. Reply done when you're back. `
      + `Never mark any Messenger chat read, not even on "clear" or "done". `
      + `Every other item is a numbered line: bold short name, one or two short sentences of real context read from the source, then one action line `
      + `starting with → (a relative link to the exact place to act or test when there is one, then the exact reply words in code, numbered with the item, `
      + `e.g. Reply 1 fixed or 1 broken). No vague italic options. Finish with **All clear** · Left for later:. `
      + `No tables, no A/B/C chunks, no headings beyond the bold header line. Never send, archive, pay, reply, approve or retry anything he has not said yes to.`,
  };
}

// A catch-up chat (its first message starts "Catch me up (cu_", wizard-os#758) shows every reply in full in TG style:
// the catch-up is already as short as it can be, so no collapsed short answer there.
const CATCHUP_FIRST = /^\W*Catch me up \(cu_/u;
export function isCatchupChat(msgs) {
  const first = (msgs || []).find(m => m && m.role === 'user');
  return !!first && CATCHUP_FIRST.test(String(first.text || ''));
}
