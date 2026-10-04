import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Check,
  CheckCheck,
  CircleHelp,
  Heart,
  LoaderCircle,
  MessageCircle,
  Pencil,
  RefreshCw,
  Search,
  Send,
  Star,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type * as api from "../lib/api";
import { explainError } from "../lib/supabase";
import {
  createComment,
  deleteComment,
  displayMember,
  editComment,
  getActivityCollaboration,
  getPreferenceOverview,
  setPreference,
  type Comment,
  type Preference,
} from "../lib/collaborationApi";
import "./ActivityCollaboration.css";

type Choice = Preference["choice"];
type DraftChoice = Choice | "unanswered";
const choices: {
  value: DraftChoice;
  label: string;
  short: string;
  icon: ReactNode;
}[] = [
  {
    value: "must",
    label: "Οπωσδήποτε",
    short: "Οπωσδήποτε",
    icon: <Star size={17} />,
  },
  { value: "yes", label: "Ναι", short: "Ναι", icon: <CheckCheck size={17} /> },
  {
    value: "maybe",
    label: "Ίσως",
    short: "Ίσως",
    icon: <CircleHelp size={17} />,
  },
  { value: "skip", label: "Πάσο", short: "Πάσο", icon: <X size={17} /> },
  {
    value: "unanswered",
    label: "Χωρίς απάντηση",
    short: "Χωρίς απάντηση",
    icon: <MessageCircle size={17} />,
  },
];
function labelFor(choice?: Choice) {
  return (
    choices.find((option) => option.value === choice)?.label ?? "Χωρίς απάντηση"
  );
}
function participationFor(
  participants: api.Participant[],
  tripId: string,
  userId: string,
) {
  return participants.find(
    (person) => person.trip_id === tripId && person.user_id === userId,
  )?.status;
}
function participationLabel(status?: string) {
  return status === "going"
    ? "Συμμετέχει"
    : status === "not_going"
      ? "Δεν συμμετέχει"
      : status === "undecided"
        ? "Το σκέφτεται"
        : "Δεν έχει δηλώσει συμμετοχή";
}

function audience(
  members: api.Member[],
  participants: api.Participant[],
  tripId: string,
) {
  const current = [
    ...new Map(members.map((member) => [member.user_id, member])).values(),
  ];
  const going = current.filter(
    (member) =>
      participationFor(participants, tripId, member.user_id) === "going",
  );
  return {
    current,
    going,
    goingIds: new Set(going.map((member) => member.user_id)),
    notGoing: current.filter(
      (member) =>
        participationFor(participants, tripId, member.user_id) === "not_going",
    ).length,
    undecided: current.filter(
      (member) =>
        participationFor(participants, tripId, member.user_id) === "undecided",
    ).length,
    missing: current.filter(
      (member) => !participationFor(participants, tripId, member.user_id),
    ).length,
  };
}

function tally(
  preferences: Preference[],
  activityId: string,
  goingIds: Set<string>,
) {
  const eligible = [
    ...new Map(
      preferences
        .filter(
          (preference) =>
            preference.activity_id === activityId &&
            goingIds.has(preference.user_id),
        )
        .map((preference) => [preference.user_id, preference]),
    ).values(),
  ];
  const counts: Record<Choice, number> = { must: 0, yes: 0, maybe: 0, skip: 0 };
  for (const preference of eligible) counts[preference.choice] += 1;
  const priorities = eligible
    .filter((preference) => preference.priority > 0)
    .map((preference) => preference.priority);
  return {
    counts,
    answered: eligible.length,
    unanswered: Math.max(0, goingIds.size - eligible.length),
    priorityAverage: priorities.length
      ? priorities.reduce((sum, value) => sum + value, 0) / priorities.length
      : null,
    priorityCount: priorities.length,
  };
}

function Alert({
  children,
  success = false,
}: {
  children: ReactNode;
  success?: boolean;
}) {
  return (
    <div
      className={`collab-alert ${success ? "positive" : ""}`}
      role={success ? "status" : "alert"}
    >
      {success ? <Check size={17} /> : <CircleHelp size={17} />}
      <span>{children}</span>
    </div>
  );
}
function Busy({ children }: { children: ReactNode }) {
  return (
    <div className="collab-loading" role="status">
      <LoaderCircle size={18} className="spin" />
      {children}
    </div>
  );
}
function CountPills({
  counts,
  unanswered,
}: {
  counts: Record<Choice, number>;
  unanswered: number;
}) {
  return (
    <div className="collab-counts" aria-label="Κατανομή προτιμήσεων">
      {choices.map((option) => (
        <span
          key={option.value}
          className={`collab-count choice-${option.value}`}
          aria-label={`${option.short}: ${option.value === "unanswered" ? unanswered : counts[option.value]}`}
        >
          <strong>
            {option.value === "unanswered" ? unanswered : counts[option.value]}
          </strong>
          {option.short}
        </span>
      ))}
    </div>
  );
}
function AudienceNote({
  members,
  participants,
  tripId,
}: {
  members: api.Member[];
  participants: api.Participant[];
  tripId: string;
}) {
  const people = audience(members, participants, tripId);
  return (
    <p className="collab-audience">
      <Users size={16} />
      <span>
        Στα σύνολα μετρούν μόνο τα {people.going.length} τωρινά μέλη που δήλωσαν
        ότι θα έρθουν.
        {people.notGoing + people.undecided + people.missing > 0 && (
          <>
            {" "}
            Εκτός συνόλων: {people.notGoing} δεν συμμετέχουν, {people.undecided}{" "}
            το σκέφτονται, {people.missing} δεν έχουν δηλώσει συμμετοχή.
          </>
        )}
      </span>
    </p>
  );
}
function readableDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Χωρίς ημερομηνία"
    : date.toLocaleString("el-GR", { dateStyle: "medium", timeStyle: "short" });
}

function useScopedData<T>(
  scope: string,
  revision: number,
  fetcher: (signal: AbortSignal) => Promise<T>,
) {
  const requestKey = `${scope}/${revision}`;
  const [state, setState] = useState<{
    scope: string;
    data?: T;
    error: string;
    loading: boolean;
    lostAccess?: boolean;
  }>({ scope: requestKey, error: "", loading: true });
  useEffect(() => {
    const controller = new AbortController();
    setState({ scope: requestKey, error: "", loading: true });
    fetcher(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ scope: requestKey, data, error: "", loading: false });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({
            scope: requestKey,
            error: explainError(error),
            loading: false,
            lostAccess: (error as { code?: string })?.code === "ACCESS_LOST",
          });
      });
    return () => controller.abort();
  }, [scope, revision]);
  return state.scope === requestKey
    ? state
    : {
        scope: requestKey,
        error: "",
        loading: true,
        data: undefined,
        lostAccess: false,
      };
}

export function ActivityCollaboration({
  item,
  tripId,
  userId,
  members,
  participants,
  isAdmin,
  onChanged,
  onAccessLost,
}: {
  item: api.Item;
  tripId: string;
  userId: string;
  members: api.Member[];
  participants: api.Participant[];
  isAdmin: boolean;
  onChanged?: () => void;
  onAccessLost?: () => void;
}) {
  const scope = `${tripId}/${item.id}/${userId}`;
  const [revision, setRevision] = useState(0);
  const state = useScopedData(scope, revision, (signal) =>
    getActivityCollaboration(item.id, signal),
  );
  const [choice, setChoice] = useState<DraftChoice>("unanswered");
  const [priority, setPriority] = useState(0);
  const [note, setNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{
    comment: Comment;
    body: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const busyRef = useRef(false);
  const currentScope = useRef(scope);
  const alive = useRef(true);
  const request = useRef({ id: crypto.randomUUID(), body: "" });
  currentScope.current = scope;
  const own = state.data?.preferences.find(
    (preference) =>
      preference.user_id === userId && preference.activity_id === item.id,
  );
  const effectiveMembers = state.data?.members ?? members;
  const effectiveParticipants = state.data?.participants ?? participants;
  const people = audience(effectiveMembers, effectiveParticipants, tripId);
  const myRole = effectiveMembers.find(
    (member) => member.user_id === userId,
  )?.role;
  const canModerate = state.data
    ? myRole === "owner" || myRole === "admin"
    : isAdmin;
  const currentMember = people.current.some(
    (member) => member.user_id === userId,
  );
  const summary = tally(
    state.data?.preferences ?? [],
    item.id,
    people.goingIds,
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (state.lostAccess) onAccessLost?.();
  }, [scope, state.lostAccess]);
  useEffect(() => {
    setChoice("unanswered");
    setPriority(0);
    setNote("");
    setDirty(false);
    setDraft("");
    setEditing(null);
    setDeleting(null);
    setError("");
    setMessage("");
    setBusy(false);
    busyRef.current = false;
    request.current = { id: crypto.randomUUID(), body: "" };
  }, [scope]);
  useEffect(() => {
    if (state.data && !dirty) {
      setChoice(own?.choice ?? "unanswered");
      setPriority(own?.priority ?? 0);
      setNote(own?.note ?? "");
    }
  }, [state.data, own, dirty]);

  function refresh() {
    setEditing(null);
    setDeleting(null);
    setDirty(false);
    setError("");
    setMessage("");
    setRevision((value) => value + 1);
  }
  async function mutate(
    work: () => Promise<unknown>,
    success: string,
    done?: () => void,
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      if (!alive.current || currentScope.current !== scope) return;
      done?.();
      setMessage(success);
      setRevision((value) => value + 1);
      onChanged?.();
    } catch (failure) {
      if (!alive.current || currentScope.current !== scope) return;
      setError(explainError(failure));
      const access = failure as { code?: string; status?: number };
      if (access.code === "42501" || access.status === 403)
        setRevision((value) => value + 1);
    } finally {
      if (alive.current && currentScope.current === scope) {
        setBusy(false);
        busyRef.current = false;
      }
    }
  }
  function savePreference(event: FormEvent) {
    event.preventDefault();
    void mutate(
      () =>
        setPreference(
          item.id,
          choice === "unanswered" ? null : choice,
          priority,
          note,
        ),
      choice === "unanswered"
        ? "Η προτίμησή σου αφαιρέθηκε."
        : "Η προτίμησή σου αποθηκεύτηκε.",
      () => setDirty(false),
    );
  }
  function addComment(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    if (request.current.body !== body)
      request.current = { id: crypto.randomUUID(), body };
    const requestId = request.current.id;
    void mutate(
      () => createComment(item.id, body, requestId),
      "Το σχόλιό σου προστέθηκε.",
      () => {
        setDraft("");
        request.current = { id: crypto.randomUUID(), body: "" };
      },
    );
  }

  if (!currentMember || item.trip_id !== tripId)
    return <Alert>Δεν έχεις πρόσβαση στη συζήτηση αυτής της πρότασης.</Alert>;
  return (
    <section
      className="activity-collaboration"
      aria-label="Προτιμήσεις και συζήτηση"
    >
      <div className="collab-heading">
        <div>
          <h3>
            <Heart size={19} /> Τι λέει η παρέα;
          </h3>
          <p>
            Μια προτίμηση βοηθά τον σχεδιασμό. Δεν είναι κράτηση ή έγκριση
            προγράμματος.
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Ανανέωση προτιμήσεων και σχολίων"
          onClick={refresh}
          disabled={busy || state.loading}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      {error && <Alert>{error}</Alert>}
      {message && <Alert success>{message}</Alert>}
      {state.loading ? (
        <Busy>Φορτώνουμε τις προτιμήσεις και τα σχόλια…</Busy>
      ) : state.error ? (
        <>
          <Alert>{state.error}</Alert>
          <button type="button" className="button secondary" onClick={refresh}>
            Δοκίμασε ξανά
          </button>
        </>
      ) : (
        state.data && (
          <>
            <div className="collab-summary">
              <div className="collab-summary-heading">
                <strong>
                  {summary.answered} / {people.going.length} απάντησαν
                </strong>
                <span>από όσους θα έρθουν</span>
              </div>
              <CountPills
                counts={summary.counts}
                unanswered={summary.unanswered}
              />
              <AudienceNote
                members={effectiveMembers}
                participants={effectiveParticipants}
                tripId={tripId}
              />
            </div>
            <form className="preference-form" onSubmit={savePreference}>
              <fieldset disabled={busy}>
                <legend>Η δική σου προτίμηση</legend>
                <div className="preference-choices">
                  {choices.map((option) => (
                    <label
                      className={`preference-choice choice-${option.value} ${choice === option.value ? "selected" : ""}`}
                      key={option.value}
                    >
                      <input
                        type="radio"
                        name={`preference-${item.id}`}
                        value={option.value}
                        checked={choice === option.value}
                        onChange={() => {
                          setChoice(option.value);
                          setDirty(true);
                        }}
                      />
                      <span className="preference-choice-icon">
                        {option.icon}
                      </span>
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {!people.goingIds.has(userId) && (
                <p className="collab-personal-note">
                  Η γνώμη σου αποθηκεύεται, αλλά θα μετρήσει στα σύνολα μόνο
                  όταν δηλώσεις ότι θα έρθεις στο ταξίδι.
                </p>
              )}
              {choice !== "unanswered" && (
                <div className="preference-extra">
                  <label>
                    Προσωπική προτεραιότητα
                    <select
                      aria-label="Προσωπική προτεραιότητα"
                      value={priority}
                      disabled={busy}
                      onChange={(event) => {
                        setPriority(Number(event.target.value));
                        setDirty(true);
                      }}
                    >
                      <option value={0}>Χωρίς βαθμό</option>
                      {[1, 2, 3, 4, 5].map((value) => (
                        <option value={value} key={value}>
                          {value} / 5
                          {value === 1
                            ? " · χαμηλή"
                            : value === 5
                              ? " · υψηλή"
                              : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Η σημείωσή σου <small>Ορατή στην παρέα · προαιρετική</small>
                    <textarea
                      aria-label="Η σημείωσή σου, ορατή στην παρέα"
                      value={note}
                      maxLength={1000}
                      rows={2}
                      disabled={busy}
                      onChange={(event) => {
                        setNote(event.target.value);
                        setDirty(true);
                      }}
                      placeholder="π.χ. Θα προτιμούσα να πάμε νωρίς το πρωί."
                    />
                  </label>
                </div>
              )}
              <div className="collab-form-actions">
                <span>
                  {dirty
                    ? "Έχεις αλλαγές που δεν αποθηκεύτηκαν."
                    : own
                      ? "Η προτίμησή σου είναι αποθηκευμένη."
                      : "Δεν έχεις απαντήσει ακόμη."}
                </span>
                <button className="button primary" disabled={busy || !dirty}>
                  {busy ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Check size={16} />
                  )}
                  Αποθήκευση προτίμησης
                </button>
              </div>
            </form>
            <details className="member-preferences">
              <summary>
                Οι απαντήσεις των μελών <span>{people.current.length}</span>
              </summary>
              <div className="member-preference-list">
                {people.current.map((member) => {
                  const preference = state.data?.preferences.find(
                    (row) =>
                      row.activity_id === item.id &&
                      row.user_id === member.user_id,
                  );
                  const status = participationFor(
                    effectiveParticipants,
                    tripId,
                    member.user_id,
                  );
                  return (
                    <div
                      key={member.user_id}
                      className={`member-preference ${status === "going" ? "" : "excluded"}`}
                    >
                      <div className="member-preference-heading">
                        <strong>
                          {displayMember(
                            effectiveMembers,
                            member.user_id,
                            userId,
                          )}
                        </strong>
                        <span
                          className={`preference-badge choice-${preference?.choice ?? "unanswered"}`}
                        >
                          {labelFor(preference?.choice)}
                        </span>
                      </div>
                      <div className="member-preference-meta">
                        <span>
                          {participationLabel(status)}
                          {status !== "going" ? " · εκτός συνόλων" : ""}
                        </span>
                        {!!preference?.priority && (
                          <span>Προτεραιότητα {preference.priority}/5</span>
                        )}
                      </div>
                      {preference?.note && <p>{preference.note}</p>}
                    </div>
                  );
                })}
              </div>
            </details>
            <div className="comments-section">
              <div className="collab-heading">
                <div>
                  <h3>
                    <MessageCircle size={19} /> Η συζήτηση{" "}
                    <span className="collab-comment-count">
                      {state.data.comments.length}
                    </span>
                  </h3>
                  <p>
                    Οι μικρές διευκρινίσεις που βοηθούν να αποφασίσετε μαζί.
                  </p>
                </div>
              </div>
              <div className="comment-list" aria-label="Σχόλια της παρέας">
                {state.data.comments.length ? (
                  state.data.comments.map((comment) => (
                    <article className="activity-comment" key={comment.id}>
                      <header>
                        <span className="comment-avatar">
                          {displayMember(
                            effectiveMembers,
                            comment.created_by,
                            userId,
                          )
                            .slice(0, 1)
                            .toUpperCase()}
                        </span>
                        <div>
                          <strong>
                            {displayMember(
                              effectiveMembers,
                              comment.created_by,
                              userId,
                            )}
                          </strong>
                          <time dateTime={comment.created_at}>
                            {readableDate(comment.created_at)}
                            {comment.updated_at !== comment.created_at
                              ? " · επεξεργασμένο"
                              : ""}
                          </time>
                        </div>
                        <div className="comment-actions">
                          {comment.created_by === userId && (
                            <button
                              type="button"
                              className="icon-button"
                              disabled={busy}
                              aria-label={`Επεξεργασία σχολίου ${displayMember(effectiveMembers, comment.created_by, userId)}`}
                              onClick={() => {
                                setEditing({ comment, body: comment.body });
                                setDeleting(null);
                              }}
                            >
                              <Pencil size={15} />
                            </button>
                          )}
                          {(comment.created_by === userId || canModerate) && (
                            <button
                              type="button"
                              className="icon-button danger"
                              disabled={busy}
                              aria-label={`Διαγραφή σχολίου ${displayMember(effectiveMembers, comment.created_by, userId)}`}
                              onClick={() => {
                                setDeleting(comment.id);
                                setEditing(null);
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </header>
                      {editing?.comment.id === comment.id ? (
                        <form
                          className="comment-edit"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const current = editing;
                            if (current?.body.trim())
                              void mutate(
                                () =>
                                  editComment(
                                    current.comment,
                                    current.body.trim(),
                                  ),
                                "Το σχόλιο ενημερώθηκε.",
                                () => setEditing(null),
                              );
                          }}
                        >
                          <label>
                            Επεξεργασία σχολίου
                            <textarea
                              aria-label="Επεξεργασία σχολίου"
                              autoFocus
                              rows={3}
                              maxLength={3000}
                              value={editing.body}
                              disabled={busy}
                              onChange={(event) =>
                                setEditing({
                                  ...editing,
                                  body: event.target.value,
                                })
                              }
                            />
                          </label>
                          <div className="comment-edit-actions">
                            <button
                              type="button"
                              className="button secondary"
                              disabled={busy}
                              onClick={() => setEditing(null)}
                            >
                              Ακύρωση
                            </button>
                            <button
                              className="button primary"
                              disabled={busy || !editing.body.trim()}
                            >
                              Αποθήκευση σχολίου
                            </button>
                          </div>
                        </form>
                      ) : (
                        <p className="comment-body">{comment.body}</p>
                      )}
                      {deleting === comment.id && (
                        <div className="comment-delete-confirm">
                          <span>
                            Να διαγραφεί αυτό το σχόλιο για όλη την παρέα;
                          </span>
                          <div>
                            <button
                              type="button"
                              className="text-button"
                              disabled={busy}
                              onClick={() => setDeleting(null)}
                            >
                              Ακύρωση
                            </button>
                            <button
                              type="button"
                              className="button danger-button"
                              disabled={busy}
                              onClick={() =>
                                void mutate(
                                  () => deleteComment(comment),
                                  "Το σχόλιο διαγράφηκε.",
                                  () => setDeleting(null),
                                )
                              }
                            >
                              Διαγραφή σχολίου
                            </button>
                          </div>
                        </div>
                      )}
                    </article>
                  ))
                ) : (
                  <div className="comments-empty">
                    <MessageCircle size={23} />
                    <p>
                      Η συζήτηση είναι ακόμα ανοιχτή.
                      <br />
                      Γράψε την πρώτη σκέψη ή ερώτηση για αυτή την ιδέα.
                    </p>
                  </div>
                )}
              </div>
              <form className="new-comment" onSubmit={addComment}>
                <label>
                  Νέο σχόλιο
                  <textarea
                    aria-label="Νέο σχόλιο"
                    rows={3}
                    maxLength={3000}
                    value={draft}
                    disabled={busy}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Τι θέλεις να μοιραστείς με την παρέα;"
                  />
                </label>
                <div className="collab-form-actions">
                  <span>{draft.length} / 3.000 χαρακτήρες</span>
                  <button
                    className="button primary"
                    disabled={busy || !draft.trim()}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Send size={16} />
                    )}
                    Προσθήκη σχολίου
                  </button>
                </div>
              </form>
            </div>
          </>
        )
      )}
    </section>
  );
}

export function PreferenceOverview({
  tripId,
  activities,
  members,
  participants,
  userId,
  onOpen,
  onAccessLost,
}: {
  tripId: string;
  activities: api.Item[];
  members: api.Member[];
  participants: api.Participant[];
  userId: string;
  onOpen: (item: api.Item) => void;
  onAccessLost?: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"must" | "yes" | "unanswered">("must");
  const scope = `${tripId}/${userId}/${activities.map((item) => item.id).join(",")}`;
  const state = useScopedData(scope, revision, (signal) =>
    getPreferenceOverview(tripId, signal),
  );
  const effectiveMembers = state.data?.members ?? members;
  const effectiveParticipants = state.data?.participants ?? participants;
  const people = audience(effectiveMembers, effectiveParticipants, tripId);
  useEffect(() => {
    if (state.lostAccess) onAccessLost?.();
  }, [scope, state.lostAccess]);
  const rows = activities
    .filter(
      (item) =>
        item.trip_id === tripId &&
        item.title
          .toLocaleLowerCase("el-GR")
          .includes(query.toLocaleLowerCase("el-GR")),
    )
    .map((item) => ({
      item,
      ...tally(state.data?.preferences ?? [], item.id, people.goingIds),
    }))
    .sort((a, b) => {
      const difference =
        sort === "unanswered"
          ? b.unanswered - a.unanswered
          : sort === "yes"
            ? b.counts.yes - a.counts.yes
            : b.counts.must - a.counts.must;
      return difference || a.item.title.localeCompare(b.item.title, "el-GR");
    });
  if (!people.current.some((member) => member.user_id === userId))
    return (
      <Alert>Δεν έχεις πρόσβαση στις προτιμήσεις αυτού του ταξιδιού.</Alert>
    );
  return (
    <section className="preference-overview" aria-label="Σύνοψη προτιμήσεων">
      <div className="collab-heading">
        <div>
          <h2>
            <Heart size={21} /> Οι προτιμήσεις της παρέας
          </h2>
          <p>Δείτε τις απαντήσεις πριν φτιάξετε το κοινό πρόγραμμα.</p>
        </div>
        <button
          className="button secondary compact"
          type="button"
          disabled={state.loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={16} />
          Ανανέωση
        </button>
      </div>
      <AudienceNote
        members={effectiveMembers}
        participants={effectiveParticipants}
        tripId={tripId}
      />
      {state.loading ? (
        <Busy>Φορτώνουμε τις προτιμήσεις…</Busy>
      ) : state.error ? (
        <>
          <Alert>{state.error}</Alert>
          <button
            className="button secondary"
            onClick={() => setRevision((value) => value + 1)}
          >
            Δοκίμασε ξανά
          </button>
        </>
      ) : (
        state.data && (
          <>
            <div className="preference-overview-toolbar">
              <label className="preference-search">
                <Search size={17} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Αναζήτηση πρότασης…"
                  aria-label="Αναζήτηση προτάσεων στις προτιμήσεις"
                />
              </label>
              <label>
                Ταξινόμηση
                <select
                  aria-label="Ταξινόμηση"
                  value={sort}
                  onChange={(event) =>
                    setSort(event.target.value as typeof sort)
                  }
                >
                  <option value="must">Περισσότερα «Οπωσδήποτε»</option>
                  <option value="yes">Περισσότερα «Ναι»</option>
                  <option value="unanswered">
                    Περισσότερες εκκρεμείς απαντήσεις
                  </option>
                </select>
              </label>
            </div>
            <p className="preference-ranking-note">
              Η σειρά ακολουθεί το επιλεγμένο πλήθος απαντήσεων. Στις ισοβαθμίες
              εμφανίζεται αλφαβητικά. Καμία επιλογή δεν προστίθεται αυτόματα στο
              πρόγραμμα.
            </p>
            {!people.going.length && (
              <div className="collab-no-travellers">
                <Users size={22} />
                <p>
                  Κανένα τωρινό μέλος δεν έχει δηλώσει ότι θα έρθει. Οι
                  αποθηκευμένες γνώμες θα μετρήσουν όταν επιβεβαιωθεί η
                  συμμετοχή στο ταξίδι.
                </p>
              </div>
            )}
            <div className="preference-ranking">
              {rows.length ? (
                rows.map(
                  (
                    {
                      item,
                      counts,
                      answered,
                      unanswered,
                      priorityAverage,
                      priorityCount,
                    },
                    index,
                  ) => {
                    const own = state.data?.preferences.find(
                      (preference) =>
                        preference.activity_id === item.id &&
                        preference.user_id === userId,
                    );
                    return (
                      <article className="preference-ranking-row" key={item.id}>
                        <div className="preference-rank">
                          {String(index + 1).padStart(2, "0")}
                        </div>
                        <div className="preference-ranking-content">
                          <button
                            type="button"
                            className="preference-item-title"
                            onClick={() => onOpen(item)}
                          >
                            {item.title}
                          </button>
                          <div className="preference-ranking-meta">
                            <strong>
                              {answered} / {people.going.length} απάντησαν
                            </strong>
                            <span>
                              Εσύ: {labelFor(own?.choice)}
                              {!people.goingIds.has(userId) && own
                                ? " · εκτός συνόλων"
                                : ""}
                            </span>
                            {priorityAverage !== null && (
                              <span>
                                Μέση προτεραιότητα{" "}
                                {priorityAverage.toLocaleString("el-GR", {
                                  maximumFractionDigits: 1,
                                })}
                                /5 · {priorityCount} βαθμοί
                              </span>
                            )}
                          </div>
                          <CountPills counts={counts} unanswered={unanswered} />
                        </div>
                        <button
                          type="button"
                          className="button secondary compact"
                          onClick={() => onOpen(item)}
                        >
                          Δες την ιδέα
                        </button>
                      </article>
                    );
                  },
                )
              ) : (
                <div className="comments-empty">
                  <Heart size={25} />
                  <p>
                    {activities.length
                      ? "Δεν βρέθηκε πρόταση με αυτή την αναζήτηση."
                      : "Προσθέστε τις πρώτες προτάσεις για να αρχίσει η παρέα να διαλέγει."}
                  </p>
                </div>
              )}
            </div>
          </>
        )
      )}
    </section>
  );
}
