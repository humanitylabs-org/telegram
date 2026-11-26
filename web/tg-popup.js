// App links open as a pop-up over TG style (wizard-os#796, switch app-popups). In a chat (a Catch me up overview
// above all), a link to another Wizard app (/messenger/, /wizard-music/, /card-benefits/) used to take the owner away
// from the thread: the shell sent it to that app's own window or desk. With the switch on, the tap asks the shell to
// show that app's page in its link sheet over this window (WizLinks.popup); closing it leaves the thread, and where it
// was scrolled, exactly as it was. An older shell without WizLinks.popup, or a link that isn't another app's page,
// keeps the old route.

const FILE = /\.(apk|aab|pdf|zip|7z|tar|t?gz|dmg|pkg|exe|msi|csv|xlsx?|docx?|pptx?|epub|mp3|m4a|aac|wav|flac|mp4|mov|mkv|webm|png|jpe?g|gif|webp|avif|bmp|svg)$/i;

// The absolute address a tapped link would pop up, or '' when the tap keeps its old route: a link outside a chat
// bubble, to another site, to Wizard itself (/wizard-os-home/), to this app's own pages, to a file or a picture, or
// one Wizard already opens in place (@thread links, Wizard Files, inline media, "open in your browser").
export function popupHref(a, here) {
  if (!a?.getAttribute || !a.closest?.('.bub')) return '';
  if (a.hasAttribute('download') || a.hasAttribute('data-session') || a.hasAttribute('data-mlink') || a.hasAttribute('data-wizard-browse') || a.closest('[data-mi]')) return '';
  const raw = a.getAttribute('href') || '';
  let u, base;
  try { base = new URL(here); u = new URL(raw, base); } catch (_) { return ''; }
  if (!/^https?:$/.test(u.protocol) || u.origin !== base.origin) return '';
  const own = base.pathname.replace(/[^/]*$/, '') || '/';
  if (own !== '/' && u.pathname.startsWith(own)) return '';
  if (/^\/wizard-os-home(\/|$)/.test(u.pathname) || u.pathname === '/' || /^\/wizard\//.test(u.pathname)) return '';
  if (FILE.test(u.pathname)) return '';
  return u.href;
}

// The click hook: true when the shell took the link (the caller then stops the tap), false to let it go on as before.
export function openPopup(shell, href) {
  if (!href || typeof shell?.WizLinks?.popup !== 'function') return false;
  try { return shell.WizLinks.popup(href) === true; } catch (_) { return false; }
}
