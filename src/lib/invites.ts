const INVITE_KEY = "gtp.pending-invite";
function readStoredInvite() {
  try {
    return sessionStorage.getItem(INVITE_KEY) ?? "";
  } catch {
    return "";
  }
}
let currentInvite = readStoredInvite();
const listeners = new Set<() => void>();

export function pendingInvite() {
  return currentInvite;
}
export function storeInvite(token: string) {
  const changed = currentInvite !== token;
  currentInvite = token;
  try {
    if (token) sessionStorage.setItem(INVITE_KEY, token);
    else sessionStorage.removeItem(INVITE_KEY);
  } catch {
    /* The current document retains the token even if storage is blocked. */
  }
  if (changed) listeners.forEach((notify) => notify());
}
export function captureInvite() {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const token = fragment.get("invite");
  if (token !== null) {
    fragment.delete("invite");
    url.hash = fragment.toString();
    history.replaceState(null, "", url);
    storeInvite(token.length <= 1024 ? token : "");
  }
}

export function subscribeInvite(notify: () => void) {
  listeners.add(notify);
  if (listeners.size === 1) {
    window.addEventListener("hashchange", captureInvite);
    window.addEventListener("popstate", captureInvite);
  }
  // Catch a link opened while React was initializing or restoring this page.
  captureInvite();
  return () => {
    listeners.delete(notify);
    if (listeners.size === 0) {
      window.removeEventListener("hashchange", captureInvite);
      window.removeEventListener("popstate", captureInvite);
    }
  };
}
