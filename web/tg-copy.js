// Copy and Share on a code block or a quote in a reply (wizard-ux issue 1671). The shell's Markdown draws those
// buttons, but only the shell's own Chats listened for them, so in this window a tap did nothing at all.
// Copy runs in this window first: the tap's user activation and focus belong to this frame, and Safari refuses a
// clipboard write from the parent page for a tap made in here. The textarea fallback covers browsers without the
// async clipboard (or a refusal), and the shell's own copy is the last try.

// What a tapped control copies or shares, or null when the tap was not on one of these buttons.
export function copyTarget(el) {
  const b = el?.closest?.('[data-codecopy],[data-codeshare],[data-quotecopy],[data-quoteshare]');
  if (!b) return null;
  const share = b.matches('[data-codeshare],[data-quoteshare]');
  const quote = b.matches('[data-quotecopy],[data-quoteshare]');
  const text = quote
    ? b.closest('blockquote[data-quote-source]')?.dataset?.quoteSource || ''
    : b.closest('.code')?.querySelector('pre')?.textContent || '';
  return { button: b, action: share ? 'share' : 'copy', kind: quote ? 'quote' : 'code', text };
}

function textareaCopy(doc, text) {
  if (!doc?.body || typeof doc.execCommand !== 'function') return false;
  const ta = doc.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  doc.body.appendChild(ta);
  let ok = false;
  try { ta.select(); ta.setSelectionRange(0, text.length); ok = doc.execCommand('copy') === true; } catch (_) { ok = false; }
  ta.remove();
  return ok;
}

// true when the text reached the clipboard, false when every way was refused. Never throws.
export async function copyText(text, { nav = globalThis.navigator, doc = globalThis.document, shell = null } = {}) {
  text = String(text ?? '');
  try { if (nav?.clipboard?.writeText) { await nav.clipboard.writeText(text); return true; } } catch (_) { /* next way */ }
  if (textareaCopy(doc, text)) return true;
  try { if (typeof shell === 'function') return (await shell(text)) === true; } catch (_) { /* refused */ }
  return false;
}

// The button says what happened, then goes back to its own word.
export function flash(button, word, ms = 1500) {
  const was = button.dataset.tgWord || button.textContent;
  button.dataset.tgWord = was;
  button.textContent = word;
  clearTimeout(button.__tgFlash);
  button.__tgFlash = setTimeout(() => { button.textContent = was; delete button.dataset.tgWord; }, ms);
}
