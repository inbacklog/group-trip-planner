import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  CalendarDays,
  CheckCircle2,
  Download,
  FileText,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type { Item, Member, Participant, Stop, Trip } from "../lib/api";
import * as plannerApi from "../lib/collaborationApi";
import { explainError } from "../lib/supabase";
import { getItemPresentation, getItemSources } from "../lib/itemDetails";
import "./trip-planner.css";

type Props = {
  trip: Trip;
  activities: Item[];
  stops: Stop[];
  members: Member[];
  participants: Participant[];
  userId: string;
  isAdmin: boolean;
  onChanged: () => void;
  onAccessLost?: () => void;
};
type PlannerData = Awaited<ReturnType<typeof plannerApi.getPlanner>>;
type DayDraft = {
  kind: "day";
  id: string | null;
  dayNumber: string;
  title: string;
  stopId: string;
  notes: string;
  version: number;
  requestId: string;
};
type ItemDraft = {
  kind: "item";
  id: string | null;
  dayId: string;
  activityId: string;
  title: string;
  position: string;
  time: string;
  duration: string;
  notes: string;
  alternative: boolean;
  subgroup: string;
  version: number;
  requestId: string;
};
type Editor = DayDraft | ItemDraft;
type Removal = {
  kind: "day" | "item";
  id: string;
  label: string;
  version: number;
};

function dateForDay(startDate: string | null | undefined, day: number) {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return "";
  const date = new Date(`${startDate}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + day - 1);
  return new Intl.DateTimeFormat("el-GR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
function integer(
  value: string,
  min: number,
  max: number,
  label: string,
): number {
  const number = Number(value);
  if (
    !value.trim() ||
    !Number.isInteger(number) ||
    number < min ||
    number > max
  )
    throw new Error(`${label}: χρειάζεται ακέραιος από ${min} έως ${max}.`);
  return number;
}
function memberName(member: Member, ownId: string) {
  const name = (
    member as Member & { display_name?: string }
  ).display_name?.trim();
  return name
    ? `${name}${member.user_id === ownId ? " (εσύ)" : ""}`
    : member.user_id === ownId
      ? "Εσύ"
      : `Μέλος ${member.user_id.slice(0, 8)}`;
}
function errorMessage(error: unknown) {
  if ((error as { code?: string })?.code === "40001")
    return "Το πρόγραμμα άλλαξε από άλλο μέλος. Οι αλλαγές σου δεν αποθηκεύτηκαν. Κλείσε τη φόρμα, ανανέωσε και άνοιξέ την ξανά για να ελέγξεις τη νεότερη έκδοση.";
  return explainError(error);
}
function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
function download(content: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TripPlanner({
  trip,
  activities: initialActivities,
  stops: initialStops,
  members: initialMembers,
  participants: initialParticipants,
  userId,
  isAdmin: initialAdmin,
  onChanged,
  onAccessLost,
}: Props) {
  const [data, setData] = useState<PlannerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [dateEditor, setDateEditor] = useState<{
    value: string;
    version: number;
  } | null>(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const onAccessLostRef = useRef(onAccessLost);
  onAccessLostRef.current = onAccessLost;

  const refresh = useCallback(
    async (initial = false) => {
      controller.current?.abort();
      const currentController = new AbortController();
      controller.current = currentController;
      const current = ++sequence.current;
      if (initial) {
        setLoading(true);
        setData(null);
      }
      try {
        const result = await plannerApi.getPlanner(
          trip.id,
          currentController.signal,
        );
        if (
          mounted.current &&
          !currentController.signal.aborted &&
          sequence.current === current
        ) {
          setData(result);
          setLoading(false);
        }
        return result;
      } catch (err) {
        if (
          mounted.current &&
          !currentController.signal.aborted &&
          sequence.current === current
        ) {
          setData(null);
          setLoading(false);
          setError(errorMessage(err));
          if ((err as { code?: string })?.code === "ACCESS_LOST")
            onAccessLostRef.current?.();
        }
        return null;
      }
    },
    [trip.id],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current++;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    setError("");
    void refresh(true);
  }, [refresh, trip.version]);
  useEffect(() => {
    // Refresh the snapshot without replacing an open draft's captured version.
    // Access revocation is still detected while someone is editing.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !pending.current)
        void refresh();
    }, 60000);
    return () => clearInterval(timer);
  }, [refresh]);

  const version = data?.trip.version ?? trip.version;
  const activities = data?.activities ?? initialActivities;
  const stops = data?.stops ?? initialStops;
  const members = data?.members ?? initialMembers;
  const participants = data?.participants ?? initialParticipants;
  const ownRole = members.find((member) => member.user_id === userId)?.role;
  const isAdmin = data
    ? ownRole === "owner" || ownRole === "admin"
    : initialAdmin;
  useEffect(() => {
    if (data && !isAdmin) {
      setEditor(null);
      setRemoval(null);
      setDateEditor(null);
    }
  }, [data, isAdmin]);
  const startDate =
    (data?.trip as (Trip & { start_date?: string | null }) | undefined)
      ?.start_date ?? null;
  const days = [...(data?.days ?? [])].sort(
    (a, b) => a.day_number - b.day_number,
  );
  const allItems = data?.items ?? [];
  const activeMembers = members.filter((member) =>
    participants.some(
      (participant) =>
        participant.user_id === member.user_id &&
        participant.status === "going",
    ),
  );
  const ownApproval = data?.approvals.find(
    (approval) => approval.user_id === userId,
  );
  const isGoing = activeMembers.some((member) => member.user_id === userId);
  const currentApprovals = activeMembers.filter((member) =>
    data?.approvals.some(
      (approval) =>
        approval.user_id === member.user_id && approval.version === version,
    ),
  );
  const itemsForDay = (dayId: string) =>
    allItems
      .filter((item) => item.day_id === dayId)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  async function mutate(
    operation: () => Promise<unknown>,
    afterSave?: () => void,
  ) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
      if (!mounted.current) return;
      afterSave?.();
      const result = await refresh();
      if (result && mounted.current) onChangedRef.current();
    } catch (err) {
      if (mounted.current) setError(errorMessage(err));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function openDay(day?: plannerApi.Day) {
    if (!data) return;
    setError("");
    setRemoval(null);
    setDateEditor(null);
    const next = (days.at(-1)?.day_number ?? 0) + 1;
    const nextAvailable =
      next <= 365
        ? next
        : (Array.from({ length: 365 }, (_, index) => index + 1).find(
            (number) => !days.some((entry) => entry.day_number === number),
          ) ?? 365);
    setEditor({
      kind: "day",
      id: day?.id ?? null,
      dayNumber: String(day?.day_number ?? nextAvailable),
      title: day?.title ?? "",
      stopId: day?.stop_id ?? "",
      notes: day?.notes ?? "",
      version,
      requestId: crypto.randomUUID(),
    });
  }
  function openItem(dayId: string, item?: plannerApi.PlanItem) {
    if (!data) return;
    const currentItems = itemsForDay(dayId);
    setError("");
    setRemoval(null);
    setDateEditor(null);
    setEditor({
      kind: "item",
      id: item?.id ?? null,
      dayId,
      activityId: item?.activity_id ?? "",
      title: item?.title ?? "",
      position: String(
        item?.position ??
          Math.min(
            10000,
            currentItems.length
              ? Math.max(...currentItems.map((entry) => entry.position)) + 1
              : 0,
          ),
      ),
      time: item?.time_slot ?? "",
      duration:
        item?.duration_minutes === null || item?.duration_minutes === undefined
          ? ""
          : String(item.duration_minutes),
      notes: item?.notes ?? "",
      alternative: item?.is_alternative ?? false,
      subgroup: item?.subgroup ?? "",
      version,
      requestId: crypto.randomUUID(),
    });
  }
  function updateDay(patch: Partial<DayDraft>) {
    setEditor((current) =>
      current?.kind === "day"
        ? { ...current, ...patch, requestId: crypto.randomUUID() }
        : current,
    );
  }
  function updateItem(patch: Partial<ItemDraft>) {
    setEditor((current) =>
      current?.kind === "item"
        ? { ...current, ...patch, requestId: crypto.randomUUID() }
        : current,
    );
  }
  function chooseActivity(activityId: string) {
    const activity = activities.find((item) => item.id === activityId);
    updateItem({ activityId, ...(activity ? { title: activity.title } : {}) });
  }
  async function saveEditor(event: FormEvent) {
    event.preventDefault();
    if (!editor || !data) return;
    try {
      if (editor.kind === "day") {
        const fields = {
          day_number: integer(editor.dayNumber, 1, 365, "Αριθμός ημέρας"),
          title: editor.title.trim(),
          stop_id: editor.stopId || null,
          notes: editor.notes,
        };
        await mutate(
          () =>
            plannerApi.saveDay(
              trip.id,
              editor.id,
              fields,
              editor.version,
              editor.requestId,
            ),
          () => setEditor(null),
        );
      } else {
        if (!editor.title.trim())
          throw new Error("Πρόσθεσε τίτλο στην καταχώριση.");
        if (editor.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(editor.time))
          throw new Error("Η ώρα πρέπει να έχει μορφή ΩΩ:ΛΛ.");
        const fields = {
          day_id: editor.dayId,
          activity_id: editor.activityId || null,
          title: editor.title.trim(),
          position: integer(editor.position, 0, 10000, "Σειρά"),
          time_slot: editor.time || null,
          duration_minutes: editor.duration
            ? integer(editor.duration, 0, 1440, "Διάρκεια")
            : null,
          notes: editor.notes,
          is_alternative: editor.alternative,
          subgroup: editor.subgroup.trim(),
        };
        await mutate(
          () =>
            plannerApi.savePlanItem(
              trip.id,
              editor.id,
              fields,
              editor.version,
              editor.requestId,
            ),
          () => setEditor(null),
        );
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function saveDate(event: FormEvent) {
    event.preventDefault();
    if (!dateEditor) return;
    await mutate(
      () =>
        plannerApi.setStartDate(
          trip.id,
          dateEditor.value || null,
          dateEditor.version,
        ),
      () => setDateEditor(null),
    );
  }
  function exportPlan(format: "json" | "html") {
    if (!data) return;
    const linked = activities.filter((activity) =>
      allItems.some((item) => item.activity_id === activity.id),
    );
    const snapshot = {
      schema_version: 1,
      kind: "group-trip-plan-snapshot",
      exported_at: new Date().toISOString(),
      trip: {
        id: trip.id,
        name: data.trip.name,
        currency: data.trip.currency,
        timezone: data.trip.timezone,
        start_date: startDate,
        version,
      },
      days,
      items: allItems,
      stops,
      activities: linked,
      approvals: data.approvals,
      participants: activeMembers.map((member) => ({
        user_id: member.user_id,
        name: memberName(member, userId),
      })),
    };
    if (format === "json") {
      download(
        JSON.stringify(snapshot, null, 2),
        "application/json;charset=utf-8",
        `trip-plan-v${version}.json`,
      );
      return;
    }
    const body = days
      .map(
        (day) =>
          `<section><h2>Ημέρα ${day.day_number}${day.title ? ` · ${escapeHtml(day.title)}` : ""}</h2><p class="muted">${escapeHtml(dateForDay(startDate, day.day_number))}${day.stop_id ? ` · ${escapeHtml(stops.find((stop) => stop.id === day.stop_id)?.name ?? "")}` : ""}</p>${day.notes ? `<p>${escapeHtml(day.notes)}</p>` : ""}<ol>${
            itemsForDay(day.id)
              .map((item) => {
                const activity = linked.find(
                  (entry) => entry.id === item.activity_id,
                );
                const presentation = activity
                  ? getItemPresentation(activity.details, data.trip.currency)
                  : null;
                const sources = activity
                  ? getItemSources(activity.details)
                  : [];
                return `<li><h3>${escapeHtml(item.title)}</h3><p class="muted">${[item.time_slot, item.duration_minutes === null ? "" : `${item.duration_minutes} λεπτά`, item.is_alternative ? "Εναλλακτική" : "", item.subgroup ? `Υποομάδα: ${item.subgroup}` : ""].filter(Boolean).map(escapeHtml).join(" · ")}</p>${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ""}${activity?.description ? `<p>${escapeHtml(activity.description)}</p>` : ""}${activity?.why_visit ? `<p><strong>Γιατί αξίζει:</strong> ${escapeHtml(activity.why_visit)}</p>` : ""}${
                  presentation
                    ? `<dl>${[
                        ["Τοποθεσία", presentation.location],
                        ["Διάρκεια", presentation.duration],
                        ["Ενδεικτικό κόστος", presentation.estimated_cost],
                        ["Κράτηση", presentation.booking],
                        ["Μετακίνηση", presentation.transport],
                        ["Χρήσιμα", presentation.tips],
                      ]
                        .filter(([, value]) => value)
                        .map(
                          ([label, value]) =>
                            `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`,
                        )
                        .join("")}</dl>`
                    : ""
                }${sources.length ? `<h4>Πηγές</h4><ul>${sources.map((source) => `<li><a href="${escapeHtml(source.url)}" rel="noopener noreferrer">${escapeHtml(source.title)}</a>${source.checked ? ` · Έλεγχος στο αρχικό υλικό: ${escapeHtml(source.checked)}` : ""}</li>`).join("")}</ul>` : ""}${activity && Object.keys(activity.details).length ? `<details><summary>Αρχικά στοιχεία αναφοράς</summary><pre>${escapeHtml(JSON.stringify(activity.details, null, 2))}</pre></details>` : ""}</li>`;
              })
              .join("") || "<li>Ελεύθερη ημέρα — χωρίς καταχωρίσεις.</li>"
          }</ol></section>`,
      )
      .join("");
    const html = `<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(data.trip.name)} · Πρόγραμμα</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:900px;margin:32px auto;padding:0 20px;color:#20342b}h1,h2,h3{line-height:1.25}section{border-top:1px solid #ccd8cf;margin-top:28px;padding-top:12px}p,dd{white-space:pre-wrap;overflow-wrap:anywhere}.muted{color:#586b60}li{margin:14px 0}dt{font-weight:bold}dd{margin:0 0 12px}a{color:#214f46;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}details{margin:12px 0}@media print{body{margin:0;max-width:none}h2,h3{break-after:avoid}li{break-inside:avoid}a{color:inherit}}</style></head><body><h1>${escapeHtml(data.trip.name)}</h1><p>Πρόγραμμα · Έκδοση ${version} · ${escapeHtml(data.trip.timezone)}</p><p class="muted">Ιδιωτικό αντίγραφο για offline ανάγνωση ή εκτύπωση. Δεν ενημερώνεται αυτόματα. Οι πηγές δεν επανελέγχθηκαν κατά την εξαγωγή.</p><p>Εγκρίσεις αυτής της έκδοσης: ${currentApprovals.length} από ${activeMembers.length} συμμετέχοντες.</p>${body || "<p>Δεν έχουν προστεθεί ημέρες.</p>"}</body></html>`;
    download(html, "text/html;charset=utf-8", `trip-plan-v${version}.html`);
  }

  return (
    <section className="trip-planner" aria-label="Πρόγραμμα ταξιδιού">
      <header className="planner-heading">
        <div>
          <span className="eyebrow">ΜΕΡΑ ΜΕ ΤΗ ΜΕΡΑ</span>
          <h2>
            <CalendarDays size={23} /> Το πρόγραμμά μας
          </h2>
          <p>
            Ξεκινήστε με Ημέρα 1, 2, 3. Οι ημερομηνίες μπορούν να περιμένουν.
          </p>
        </div>
        <button
          className="button secondary compact"
          onClick={() => {
            setError("");
            void refresh(true);
          }}
          disabled={busy || loading}
        >
          <RefreshCw size={15} /> Ανανέωση προγράμματος
        </button>
      </header>
      {error && (
        <div className="notice planner-error" role="alert">
          {error}
        </div>
      )}
      {loading && (
        <p className="planner-loading" role="status">
          <LoaderCircle className="spin" size={18} /> Φόρτωση προγράμματος…
        </p>
      )}
      {!loading && data && (
        <>
          <div className="planner-toolbar">
            <div className="planner-date">
              <strong>
                {startDate
                  ? `Ημέρα 1: ${dateForDay(startDate, 1)}`
                  : "Χωρίς ημερομηνίες ακόμα"}
              </strong>
              <span>Οι ώρες αφορούν τη ζώνη {data.trip.timezone}.</span>
              {isAdmin && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setEditor(null);
                    setRemoval(null);
                    setDateEditor({ value: startDate ?? "", version });
                  }}
                >
                  {startDate
                    ? "Αλλαγή ημερομηνίας έναρξης"
                    : "Ορισμός ημερομηνίας έναρξης"}
                </button>
              )}
            </div>
            <div className="planner-actions">
              <button
                className="button secondary compact"
                disabled={busy}
                onClick={() => exportPlan("json")}
              >
                <Download size={15} /> JSON προγράμματος
              </button>
              <button
                className="button secondary compact"
                disabled={busy}
                onClick={() => exportPlan("html")}
              >
                <FileText size={15} /> Offline / εκτύπωση
              </button>
              {isAdmin && (
                <button
                  className="button primary compact"
                  disabled={busy || days.length >= 365}
                  onClick={() => openDay()}
                >
                  <Plus size={16} /> Προσθήκη ημέρας
                </button>
              )}
            </div>
          </div>
          {dateEditor && (
            <form
              className="planner-editor planner-date-editor"
              onSubmit={saveDate}
              aria-label="Ημερομηνία έναρξης"
            >
              <h3>Πότε αρχίζει η Ημέρα 1;</h3>
              <p className="field-hint">
                Η αλλαγή αντιστοιχίζει τις σχετικές ημέρες σε ημερομηνίες. Δεν
                αλλάζει τις σημειώσεις ή τα στοιχεία κρατήσεων.
              </p>
              <label>
                Ημερομηνία έναρξης
                <input
                  aria-label="Ημερομηνία έναρξης"
                  type="date"
                  value={dateEditor.value}
                  disabled={busy}
                  onChange={(event) =>
                    setDateEditor({ ...dateEditor, value: event.target.value })
                  }
                />
              </label>
              <div className="planner-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setDateEditor(null)}
                >
                  Ακύρωση
                </button>
                {startDate && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        () =>
                          plannerApi.setStartDate(
                            trip.id,
                            null,
                            dateEditor.version,
                          ),
                        () => setDateEditor(null),
                      )
                    }
                  >
                    Αφαίρεση ημερομηνίας
                  </button>
                )}
                <button className="button primary" disabled={busy}>
                  Αποθήκευση ημερομηνίας
                </button>
              </div>
            </form>
          )}
          {editor && (
            <form
              className="planner-editor"
              onSubmit={saveEditor}
              aria-label={
                editor.kind === "day"
                  ? "Φόρμα ημέρας"
                  : "Φόρμα καταχώρισης προγράμματος"
              }
            >
              <div className="planner-editor-heading">
                <h3>
                  {editor.kind === "day"
                    ? editor.id
                      ? "Επεξεργασία ημέρας"
                      : "Μια νέα ημέρα"
                    : editor.id
                      ? "Επεξεργασία καταχώρισης"
                      : "Προσθήκη στο πρόγραμμα"}
                </h3>
                <button
                  type="button"
                  className="icon-button"
                  disabled={busy}
                  aria-label="Κλείσιμο φόρμας προγράμματος"
                  onClick={() => setEditor(null)}
                >
                  <X size={19} />
                </button>
              </div>
              <div className="planner-fields">
                {editor.kind === "day" ? (
                  <>
                    <label>
                      Αριθμός ημέρας
                      <input
                        aria-label="Αριθμός ημέρας"
                        autoFocus
                        type="number"
                        min="1"
                        max="365"
                        step="1"
                        required
                        value={editor.dayNumber}
                        disabled={busy}
                        onChange={(event) =>
                          updateDay({ dayNumber: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Τίτλος ημέρας (προαιρετικό)
                      <input
                        aria-label="Τίτλος ημέρας (προαιρετικό)"
                        maxLength={120}
                        value={editor.title}
                        disabled={busy}
                        onChange={(event) =>
                          updateDay({ title: event.target.value })
                        }
                      />
                    </label>
                    <label className="planner-full">
                      Στάση ημέρας
                      <select
                        aria-label="Στάση ημέρας"
                        value={editor.stopId}
                        disabled={busy}
                        onChange={(event) =>
                          updateDay({ stopId: event.target.value })
                        }
                      >
                        <option value="">Χωρίς συγκεκριμένη στάση</option>
                        {stops.map((stop) => (
                          <option key={stop.id} value={stop.id}>
                            {stop.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="planner-full">
                      Σημειώσεις ημέρας
                      <textarea
                        aria-label="Σημειώσεις ημέρας"
                        rows={3}
                        maxLength={3000}
                        value={editor.notes}
                        disabled={busy}
                        onChange={(event) =>
                          updateDay({ notes: event.target.value })
                        }
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      Ημέρα προγράμματος
                      <select
                        aria-label="Ημέρα προγράμματος"
                        value={editor.dayId}
                        disabled={busy}
                        onChange={(event) =>
                          updateItem({ dayId: event.target.value })
                        }
                      >
                        {days.map((day) => (
                          <option key={day.id} value={day.id}>
                            Ημέρα {day.day_number}
                            {day.title ? ` · ${day.title}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Σύνδεση με πρόταση
                      <select
                        aria-label="Σύνδεση με πρόταση"
                        value={editor.activityId}
                        disabled={busy}
                        onChange={(event) => chooseActivity(event.target.value)}
                      >
                        <option value="">
                          Ελεύθερη καταχώριση — π.χ. μεταφορά ή ξεκούραση
                        </option>
                        {activities.map((activity) => (
                          <option key={activity.id} value={activity.id}>
                            {activity.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="planner-full">
                      Τίτλος καταχώρισης
                      <input
                        aria-label="Τίτλος καταχώρισης"
                        autoFocus
                        required
                        maxLength={200}
                        value={editor.title}
                        disabled={busy}
                        onChange={(event) =>
                          updateItem({ title: event.target.value })
                        }
                        placeholder="π.χ. Ελεύθερος χρόνος ή διαδρομή"
                      />
                    </label>
                    <label>
                      Ώρα (προαιρετικό)
                      <input
                        aria-label="Ώρα (προαιρετικό)"
                        type="time"
                        step="60"
                        value={editor.time}
                        disabled={busy}
                        onChange={(event) =>
                          updateItem({ time: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Διάρκεια σε λεπτά (προαιρετικό)
                      <input
                        aria-label="Διάρκεια σε λεπτά (προαιρετικό)"
                        type="number"
                        min="0"
                        max="1440"
                        step="1"
                        value={editor.duration}
                        disabled={busy}
                        onChange={(event) =>
                          updateItem({ duration: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Σειρά μέσα στην ημέρα
                      <input
                        aria-label="Σειρά μέσα στην ημέρα"
                        type="number"
                        min="0"
                        max="10000"
                        step="1"
                        required
                        value={editor.position}
                        disabled={busy}
                        onChange={(event) =>
                          updateItem({ position: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Υποομάδα (προαιρετικό)
                      <input
                        aria-label="Υποομάδα (προαιρετικό)"
                        maxLength={120}
                        value={editor.subgroup}
                        disabled={busy}
                        onChange={(event) =>
                          updateItem({ subgroup: event.target.value })
                        }
                        placeholder="π.χ. Όσοι θέλουν πεζοπορία"
                      />
                    </label>
                    <label className="planner-checkbox planner-full">
                      <input
                        aria-label="Εναλλακτική επιλογή"
                        type="checkbox"
                        checked={editor.alternative}
                        disabled={busy}
                        onChange={(event) =>
                          updateItem({ alternative: event.target.checked })
                        }
                      />{" "}
                      Εναλλακτική επιλογή
                    </label>
                    <label className="planner-full">
                      Σημειώσεις καταχώρισης
                      <textarea
                        aria-label="Σημειώσεις καταχώρισης"
                        rows={3}
                        maxLength={3000}
                        value={editor.notes}
                        disabled={busy}
                        onChange={(event) =>
                          updateItem({ notes: event.target.value })
                        }
                      />
                    </label>
                  </>
                )}
              </div>
              <p className="field-hint">
                Αποθήκευση πάνω στην έκδοση {editor.version}. Νεότερες αλλαγές
                άλλου μέλους ελέγχονται πριν αποθηκευτεί.
              </p>
              <div className="planner-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setEditor(null)}
                >
                  Ακύρωση
                </button>
                <button className="button primary" disabled={busy}>
                  {busy && <LoaderCircle className="spin" size={16} />}{" "}
                  {editor.kind === "day"
                    ? "Αποθήκευση ημέρας"
                    : "Αποθήκευση στο πρόγραμμα"}
                </button>
              </div>
            </form>
          )}
          {removal && (
            <div className="planner-confirm" role="alert">
              <p>Να διαγραφεί το «{removal.label}» από το κοινό πρόγραμμα;</p>
              <div className="planner-actions">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setRemoval(null)}
                >
                  Ακύρωση διαγραφής
                </button>
                <button
                  className="button danger-button"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      () =>
                        removal.kind === "day"
                          ? plannerApi.deleteDay(removal.id, removal.version)
                          : plannerApi.deletePlanItem(
                              removal.id,
                              removal.version,
                            ),
                      () => setRemoval(null),
                    )
                  }
                >
                  Επιβεβαίωση διαγραφής
                </button>
              </div>
            </div>
          )}
          <div className="planner-days">
            {days.length ? (
              days.map((day) => {
                const items = itemsForDay(day.id);
                return (
                  <article
                    className="planner-day"
                    key={day.id}
                    aria-label={`Ημέρα ${day.day_number}`}
                  >
                    <header className="planner-day-heading">
                      <div>
                        <span className="planner-day-number">
                          Ημέρα {day.day_number}
                        </span>
                        <h3>
                          {day.title || "Μια ημέρα για τις δικές σας ιδέες"}
                        </h3>
                        <p>
                          {dateForDay(startDate, day.day_number)}
                          {day.stop_id && (
                            <span>
                              {startDate ? " · " : ""}
                              {stops.find((stop) => stop.id === day.stop_id)
                                ?.name ?? "Στάση"}
                            </span>
                          )}
                        </p>
                      </div>
                      {isAdmin && (
                        <div className="planner-day-controls">
                          <button
                            className="icon-button"
                            disabled={busy}
                            aria-label={`Επεξεργασία ημέρας ${day.day_number}`}
                            onClick={() => openDay(day)}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            className="icon-button danger"
                            disabled={busy || items.length > 0}
                            aria-label={`Διαγραφή ημέρας ${day.day_number}`}
                            title={
                              items.length
                                ? "Αφαίρεσε πρώτα τις καταχωρίσεις της ημέρας"
                                : "Διαγραφή κενής ημέρας"
                            }
                            onClick={() => {
                              setEditor(null);
                              setRemoval({
                                kind: "day",
                                id: day.id,
                                label: `Ημέρα ${day.day_number}`,
                                version,
                              });
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )}
                    </header>
                    {day.notes && (
                      <p className="planner-day-notes">{day.notes}</p>
                    )}
                    {items.length ? (
                      <ol className="planner-items">
                        {items.map((item) => (
                          <li
                            key={item.id}
                            className={
                              item.is_alternative
                                ? "planner-item alternative"
                                : "planner-item"
                            }
                          >
                            <div className="planner-item-time">
                              {item.time_slot || "Χωρίς ώρα"}
                              {item.duration_minutes !== null && (
                                <small>{item.duration_minutes} λεπτά</small>
                              )}
                            </div>
                            <div className="planner-item-body">
                              <div className="planner-item-title">
                                <h4>{item.title}</h4>
                                {item.is_alternative && (
                                  <span className="planner-tag">
                                    Εναλλακτική
                                  </span>
                                )}
                                {item.subgroup && (
                                  <span className="planner-tag">
                                    {item.subgroup}
                                  </span>
                                )}
                              </div>
                              {item.activity_id && (
                                <p className="planner-source-note">
                                  Από τις προτάσεις της παρέας
                                </p>
                              )}
                              {item.notes && <p>{item.notes}</p>}
                            </div>
                            {isAdmin && (
                              <div className="planner-item-controls">
                                <button
                                  className="icon-button"
                                  disabled={busy}
                                  aria-label={`Επεξεργασία στο πρόγραμμα ${item.title}`}
                                  onClick={() => openItem(day.id, item)}
                                >
                                  <Pencil size={15} />
                                </button>
                                <button
                                  className="icon-button danger"
                                  disabled={busy}
                                  aria-label={`Διαγραφή από το πρόγραμμα ${item.title}`}
                                  onClick={() => {
                                    setEditor(null);
                                    setRemoval({
                                      kind: "item",
                                      id: item.id,
                                      label: item.title,
                                      version,
                                    });
                                  }}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            )}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="planner-empty-day">
                        Ελεύθερη ημέρα. Προσθέστε μια ιδέα ή κρατήστε χώρο για
                        αυθόρμητες επιλογές.
                      </p>
                    )}
                    {isAdmin && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => openItem(day.id)}
                        aria-label={`Προσθήκη στην ημέρα ${day.day_number}`}
                      >
                        <Plus size={16} /> Προσθήκη στην ημέρα
                      </button>
                    )}
                  </article>
                );
              })
            ) : (
              <div className="planner-empty">
                <CalendarDays size={30} />
                <h3>Το πρόγραμμα αρχίζει από την Ημέρα 1</h3>
                <p>
                  {isAdmin
                    ? "Πρόσθεσε ημέρες και οργανώστε τις ιδέες σας, ακόμη κι αν δεν ξέρετε πότε θα ταξιδέψετε."
                    : "Ένας διαχειριστής μπορεί να προσθέσει ημέρες και τις ιδέες της παρέας."}
                </p>
              </div>
            )}
          </div>
          <section
            className="planner-approvals"
            aria-label="Εγκρίσεις προγράμματος"
          >
            <div className="planner-approval-heading">
              <CheckCircle2 size={22} />
              <div>
                <h3>Συμφωνούμε σε αυτό το πρόγραμμα;</h3>
                <p>
                  Έκδοση {version} · {currentApprovals.length} από{" "}
                  {activeMembers.length} συμμετέχοντες έχουν εγκρίνει.
                </p>
              </div>
            </div>
            <p className="field-hint">
              Η έγκριση αφορά τη συγκεκριμένη έκδοση. Αλλαγές στο πρόγραμμα, στο
              περιεχόμενο ή στη συμμετοχή χρειάζονται νέα έγκριση.
            </p>
            {activeMembers.length > 0 && (
              <ul className="planner-approval-list">
                {activeMembers.map((member) => {
                  const approval = data.approvals.find(
                    (entry) => entry.user_id === member.user_id,
                  );
                  return (
                    <li key={member.user_id}>
                      <strong>{memberName(member, userId)}</strong>
                      <span>
                        {approval?.version === version
                          ? "Έγκριση τρέχουσας έκδοσης"
                          : approval
                            ? `Παλαιότερη έγκριση · έκδοση ${approval.version}`
                            : "Δεν έχει εγκρίνει ακόμα"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {isGoing ? (
              <button
                className={
                  ownApproval?.version === version
                    ? "button secondary"
                    : "button primary"
                }
                disabled={busy || !!editor || !!dateEditor || !!removal}
                onClick={() =>
                  void mutate(() =>
                    plannerApi.setApproval(
                      trip.id,
                      version,
                      ownApproval?.version !== version,
                    ),
                  )
                }
              >
                {ownApproval?.version === version
                  ? "Ανάκληση της έγκρισής μου"
                  : "Εγκρίνω αυτή την έκδοση"}
              </button>
            ) : (
              <p className="planner-approval-hint">
                Για να εγκρίνεις, δήλωσε πρώτα «Ναι, μέσα!» στη συμμετοχή σου
                στο ταξίδι.
              </p>
            )}
          </section>
        </>
      )}
      {!loading && !data && !error && <p>Το πρόγραμμα δεν είναι διαθέσιμο.</p>}
    </section>
  );
}

export default TripPlanner;
