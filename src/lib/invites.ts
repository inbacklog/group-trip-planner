const INVITE_KEY = "gtp.pending-invite";
export function pendingInvite() {
  try {
    return sessionStorage.getItem(INVITE_KEY) ?? "";
  } catch {
    return "";
  }
}
export function storeInvite(token: string) {
  try {
    if (token) sessionStorage.setItem(INVITE_KEY, token);
    else sessionStorage.removeItem(INVITE_KEY);
  } catch {
    /* Current page can still keep the token in memory. */
  }
}
export function captureInvite() {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const token = fragment.get("invite");
  if (token !== null) {
    storeInvite(token.length <= 1024 ? token : "");
    fragment.delete("invite");
    url.hash = fragment.toString();
    history.replaceState(null, "", url);
  }
}
