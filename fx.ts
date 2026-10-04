import { useEffect, useState } from "react";
import { normalizeCurrency, parseFxRate, type FxRate } from "./money";
type FxState = { rate?: FxRate; loading: boolean; error: string };
const states = new Map<string, FxState>();
const listeners = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<void>>();
const retryAfter = new Map<string, number>();
const TTL = 12 * 60 * 60 * 1000;
const key = (c: string) => `gtp:public-fx:ecb:v1:${c}:EUR`;
function snapshot(currency: string): FxState {
  if (!states.has(currency)) {
    let rate: FxRate | undefined;
    try {
      const cached = JSON.parse(localStorage.getItem(key(currency)) ?? "null");
      if (cached && typeof cached.fetchedAt === "number" && cached.fetchedAt > 0 && cached.fetchedAt <= Date.now()) {
        rate = { ...parseFxRate(cached, currency), fetchedAt: cached.fetchedAt };
      }
    } catch { /* Storage may be disabled. No private data is stored here. */ }
    states.set(currency, { rate, loading: false, error: "" });
  }
  return states.get(currency)!;
}
function publish(currency: string, next: FxState) {
  states.set(currency, next);
  listeners.get(currency)?.forEach((fn) => fn());
}
export async function refreshRate(currency: string, force = false): Promise<void> {
  if (!currency || currency === "EUR") return;
  const current = snapshot(currency);
  if (inflight.has(currency)) return inflight.get(currency);
  if (!force && ((current.rate && Date.now() - current.rate.fetchedAt < TTL) || Date.now() < (retryAfter.get(currency) ?? 0))) return;
  const task = (async () => {
    publish(currency, { ...current, loading: true, error: "" });
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    try {
      // Only a currency pair is sent. Never send costs, trip IDs, names or auth tokens.
      const response = await fetch(`https://api.frankfurter.dev/v2/providers/ecb/rate/${currency.toLowerCase()}/eur`, {
        credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal,
      });
      if (!response.ok) throw new Error("Rate unavailable");
      const rate = parseFxRate(await response.json(), currency);
      try { localStorage.setItem(key(currency), JSON.stringify(rate)); } catch { /* Optional public cache. */ }
      retryAfter.delete(currency);
      publish(currency, { rate, loading: false, error: "" });
    } catch {
      retryAfter.set(currency, Date.now() + 60000);
      publish(currency, { rate: current.rate, loading: false,
        error: current.rate ? "Δεν έγινε ανανέωση· χρησιμοποιείται η αποθηκευμένη ισοτιμία." : "Η μετατροπή σε ευρώ δεν είναι διαθέσιμη τώρα." });
    } finally { window.clearTimeout(timer); }
  })();
  inflight.set(currency, task);
  try { await task; } finally { inflight.delete(currency); }
}
export function useFxRate(code: string): FxState {
  const currency = normalizeCurrency(code);
  const [state, setState] = useState(() => snapshot(currency));
  useEffect(() => {
    const update = () => setState(snapshot(currency));
    if (!listeners.has(currency)) listeners.set(currency, new Set());
    listeners.get(currency)!.add(update);
    update();
    void refreshRate(currency);
    return () => { listeners.get(currency)?.delete(update); };
  }, [currency]);
  // Never render a previous currency's rate during a React prop transition.
  return state.rate && state.rate.base !== currency ? snapshot(currency) : state;
}
/** An offline export may use only a rate already available, never pretend it refreshed. */
export function cachedRate(code: string): FxRate | undefined {
  return snapshot(normalizeCurrency(code)).rate;
}

