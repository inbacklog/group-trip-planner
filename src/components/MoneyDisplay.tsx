import { COST_UNITS, formatCost, getCost, isOldRate, FX_SOURCE_NAME, FX_SOURCE_URL, type CostDraft } from "../lib/money";
import { refreshRate, useFxRate } from "../lib/fx";

export function MoneyDisplay({ details, currency, compact = false }: {
  details: Record<string, unknown>; currency: string; compact?: boolean;
}) {
  const cost = getCost(details, currency);
  const fx = useFxRate(cost?.currency ?? "");
  if (!cost) return <span className="money-block money-unknown">Κόστος: μη καταγεγραμμένο αριθμητικά</span>;
  const original = formatCost(cost);
  const euro = cost.currency === "EUR" ? "" : fx.rate ? `≈ ${formatCost(cost, fx.rate.rate, "EUR")}` : "";
  const unit = cost.unit === "unknown" ? "" : COST_UNITS[cost.unit];
  const date = fx.rate?.date.split("-").reverse().join("/");
  const reference = fx.rate ? `${FX_SOURCE_NAME} · ${date} · 1 ${cost.currency} = ${fx.rate.rate} EUR` : "";
  if (compact) return <span className="money-block" title={cost.currency === "EUR" ? undefined : reference || fx.error}>
    <span className="money-original">{original}{unit && <span> / {unit.replace(/^ανά /, "")}</span>}</span>
    {cost.currency !== "EUR" && <span className="money-euro">{euro || (fx.loading ? "Μετατροπή σε €…" : "€ μη διαθέσιμο")}{fx.rate && (isOldRate(fx.rate) || fx.error) ? " · αποθηκευμένη τιμή" : ""}</span>}
  </span>;
  return <section className="money-detail" aria-label="Κόστος και μετατροπή σε ευρώ">
    <div className="money-values"><strong>{original}</strong>{euro && <span>{euro}</span>}</div>
    <p>{COST_UNITS[cost.unit]}</p>
    {cost.currency !== "EUR" && <>
      {fx.rate && <p className="money-source"><a href={FX_SOURCE_URL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{FX_SOURCE_NAME}</a> · {date}<br/>1 {cost.currency} = {fx.rate.rate} EUR{isOldRate(fx.rate) && " · Παλαιότερη ισοτιμία"}</p>}
      {fx.error && <p role="status" className="field-help">{fx.error}</p>}
      {fx.loading && <p role="status">Αναζήτηση ισοτιμίας…</p>}
      <button type="button" className="text-button" disabled={fx.loading || !cost.currency} onClick={() => void refreshRate(cost.currency, true)}>Ανανέωση ισοτιμίας</button>
      <p className="field-help">Ενδεικτική μετατροπή, όχι τιμή πληρωμής. Δεν περιλαμβάνει προμήθειες κάρτας ή ανταλλακτηρίου. Η αρχική τιμή δεν αλλάζει.</p>
    </>}
  </section>;
}
export function MoneyFields({ value, onChange }: { value: CostDraft; onChange: (value: CostDraft) => void }) {
  return <fieldset className="money-fields"><legend>Ποσό για αυτόματη μετατροπή σε ευρώ</legend>
    <p className="field-help">Άφησε και τα δύο ποσά κενά όταν δεν γνωρίζεις το κόστος. Το 0 δηλώνει πραγματικό μηδενικό ποσό. Για μία τιμή συμπλήρωσε μόνο το πρώτο πεδίο. Αυτά τα ποσά χρησιμοποιούνται στη μετατροπή· η περιγραφή κόστους παρακάτω κρατά τις πρόσθετες σημειώσεις.</p>
    <div className="money-input-grid">
      <label>Ποσό / ελάχιστο<input inputMode="decimal" maxLength={16} value={value.min} placeholder="π.χ. 100" onChange={(e) => onChange({ ...value, min: e.target.value })}/></label>
      <label>Μέγιστο ποσό (προαιρετικό)<input inputMode="decimal" maxLength={16} value={value.max} placeholder="π.χ. 150" onChange={(e) => onChange({ ...value, max: e.target.value })}/></label>
      <label>Νόμισμα ποσού<input maxLength={3} value={value.currency} placeholder="CNY" onChange={(e) => onChange({ ...value, currency: e.target.value.toUpperCase() })}/></label>
      <label>Το ποσό αφορά<select value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value as CostDraft["unit"] })}>{Object.entries(COST_UNITS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </div>
  </fieldset>;
}
