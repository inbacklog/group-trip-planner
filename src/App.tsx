import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronRight,
  CircleHelp,
  Compass,
  Copy,
  Download,
  ExternalLink,
  Globe2,
  Heart,
  Hotel,
  Link2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MapPin,
  Menu,
  Pencil,
  Plane,
  Plus,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  TrainFront,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import {
  configurationError,
  explainError,
  requireClient,
  supabase,
} from "./lib/supabase";
import * as api from "./lib/api";
import {
  ActivityCollaboration,
  PreferenceOverview,
} from "./components/ActivityCollaboration";
import { TripPlanner } from "./components/TripPlanner";
import { displayMember, setMemberDisplayName } from "./lib/collaborationApi";
import "./components/workspace-navigation.css";
import {
  ItemDetailFields,
  ItemInformation,
} from "./components/ItemInformation";
import { getItemPresentation, saveItemPresentation } from "./lib/itemDetails";
import {
  getImportSummary,
  MAX_IMPORT_BYTES,
  parsePrivateImport,
  safeExternalUrl,
  type PrivateTripImport,
} from "./lib/privateImport";
import { pendingInvite, storeInvite, subscribeInvite } from "./lib/invites";
import "./styles.css";

function routeTo(group?: string, trip?: string) {
  const url = new URL(location.href);
  url.searchParams.delete("group");
  url.searchParams.delete("trip");
  if (group) url.searchParams.set("group", group);
  if (trip) url.searchParams.set("trip", trip);
  history.replaceState(null, "", url);
}
function useAsyncData<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
) {
  const [state, setState] = useState<{
    data?: T;
    error: string;
    loading: boolean;
  }>({ error: "", loading: true });
  useEffect(() => {
    const controller = new AbortController();
    setState({ error: "", loading: true });
    fetcher(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ data, error: "", loading: false });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ error: explainError(error), loading: false });
      });
    return () => controller.abort();
  }, deps); // callers supply stable primitive dependencies
  return state;
}
const uid = () => crypto.randomUUID();

function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? "small" : ""}`}>
      <span className="brand-icon">
        <Compass size={23} />
      </span>
      <span>
        Group Trip<span className="brand-second">Planner</span>
      </span>
    </div>
  );
}
function Loading({ text = "Φορτώνουμε το ταξίδι σου…" }: { text?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} />
      <span>{text}</span>
    </div>
  );
}
function Notice({
  children,
  success = false,
}: {
  children: ReactNode;
  success?: boolean;
}) {
  return (
    <div
      className={`notice ${success ? "success" : ""}`}
      role={success ? "status" : "alert"}
    >
      {success ? <Check size={18} /> : <CircleHelp size={18} />}
      <span>{children}</span>
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
  busy = false,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal-inner">
        <div className="modal-heading">
          <h2 id="modal-title">{title}</h2>
          <button
            className="icon-button"
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="Κλείσιμο"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
function JourneyArt() {
  return (
    <svg
      className="journey-art"
      viewBox="0 0 470 250"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="344" cy="100" r="77" fill="#EFE9D8" />
      <circle cx="344" cy="100" r="58" stroke="#D8D4C2" />
      <path
        d="M286 100h116M344 42c-40 36-40 80 0 116M344 42c40 36 40 80 0 116M294 72h100M294 128h100"
        stroke="#D8D4C2"
      />
      <path
        d="M60 186c44-97 123 58 175-21S335 45 405 80"
        stroke="#567A6B"
        strokeWidth="2"
        strokeDasharray="5 7"
      />
      <circle
        cx="63"
        cy="182"
        r="8"
        fill="#E78558"
        stroke="#FFFDF7"
        strokeWidth="4"
      />
      <circle
        cx="403"
        cy="79"
        r="8"
        fill="#214F46"
        stroke="#FFFDF7"
        strokeWidth="4"
      />
      <g transform="translate(219 91) rotate(-25)">
        <path d="M0 19 76 0 45 58 32 33 0 19Z" fill="#D8784D" />
        <path d="M32 33 76 0 20 25" fill="#EBAD85" />
        <path d="M32 33 30 46 40 42" fill="#BB6544" />
      </g>
      <path
        d="M101 96v41m-16-25 16-16 16 16M115 138H87"
        stroke="#D1C9B4"
        strokeWidth="2"
      />
      <path d="m372 195 8 8 8-8m-8-8v16" stroke="#D1C9B4" strokeWidth="2" />
      <circle cx="159" cy="52" r="3" fill="#D1C9B4" />
      <circle cx="435" cy="172" r="4" fill="#D1C9B4" />
    </svg>
  );
}

function Auth({
  invite,
  onRecoveryDone,
  recovery = false,
}: {
  invite: string;
  onRecoveryDone: () => void;
  recovery?: boolean;
}) {
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState(() => {
    const url = new URL(location.href);
    const fragment = new URLSearchParams(url.hash.slice(1));
    const callbackError =
      url.searchParams.get("error") ?? fragment.get("error");
    if (!callbackError) return "";
    return callbackError === "access_denied"
      ? "Η σύνδεση με Google ακυρώθηκε. Μπορείς να δοκιμάσεις ξανά ή να συνδεθείς με email."
      : "Η σύνδεση με Google δεν ολοκληρώθηκε. Δοκίμασε ξανά ή συνδέσου με email.";
  });
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  useEffect(() => {
    const url = new URL(location.href);
    const fragment = new URLSearchParams(url.hash.slice(1));
    if (url.searchParams.has("error") || fragment.has("error")) {
      for (const key of ["error", "error_code", "error_description"]) {
        url.searchParams.delete(key);
        fragment.delete(key);
      }
      url.hash = fragment.toString();
      history.replaceState(null, "", url);
    }
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setBusy(false);
        setGoogleBusy(false);
      }
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);
  async function continueWithGoogle() {
    setBusy(true);
    setGoogleBusy(true);
    setError("");
    setMessage("");
    try {
      const { error: oauthError } = await requireClient().auth.signInWithOAuth({
        provider: "google",
        options: {
          // The browser client exchanges the PKCE code at this existing entry.
          // Invite tokens stay in sessionStorage, never in the provider URL.
          redirectTo: `${location.origin}${location.pathname}`,
          queryParams: { prompt: "select_account" },
        },
      });
      if (oauthError) throw oauthError;
      // Keep both sign-in methods disabled until the browser leaves the page.
    } catch (err) {
      setError(explainError(err));
      setBusy(false);
      setGoogleBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const client = requireClient();
      const redirect = `${location.origin}${location.pathname}`;
      if (recovery) {
        const result = await client.auth.updateUser({ password });
        if (result.error) throw result.error;
        setPassword("");
        onRecoveryDone();
      } else if (mode === "login") {
        const result = await client.auth.signInWithPassword({
          email,
          password,
        });
        if (result.error) throw result.error;
      } else if (mode === "signup") {
        const result = await client.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirect },
        });
        if (result.error) throw result.error;
        if (!result.data.session) {
          setMessage(
            "Έλεγξε το email σου για επιβεβαίωση. Αν υπάρχει ήδη λογαριασμός, δοκίμασε σύνδεση ή επαναφορά κωδικού.",
          );
          setPassword("");
        }
      } else {
        const result = await client.auth.resetPasswordForEmail(email, {
          redirectTo: redirect,
        });
        if (result.error) throw result.error;
        setMessage(
          "Αν υπάρχει λογαριασμός με αυτό το email, θα λάβεις σύνδεσμο επαναφοράς.",
        );
      }
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-story">
        <Brand />
        <div className="auth-copy">
          <span className="eyebrow">ΚΑΛΥΤΕΡΑ, ΜΑΖΙ.</span>
          <h1>
            Μια παρέα.
            <br />
            Χίλιες ιδέες.
            <br />
            <em>Ένα ταξίδι.</em>
          </h1>
          <p>
            Ο δικός σας χώρος για τα μέρη, τις ιδέες και τις μικρές λεπτομέρειες
            που κάνουν ένα ταξίδι ξεχωριστό.
          </p>
          <JourneyArt />
        </div>
        <div className="auth-foot">
          <LockKeyhole size={16} /> Τα ταξίδια σας μένουν στην παρέα σας.
        </div>
      </div>
      <main className="auth-panel">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <div className="auth-card">
          <span className="label-pill">
            <Compass size={14} /> Η επόμενη περιπέτεια αρχίζει εδώ
          </span>
          <h2>
            {recovery
              ? "Νέος κωδικός"
              : mode === "signup"
                ? "Φτιάξε τον χώρο σου"
                : mode === "reset"
                  ? "Πάμε ξανά από την αρχή"
                  : "Καλώς ήρθες ξανά"}
          </h2>
          <p className="muted">
            {recovery
              ? "Διάλεξε έναν νέο κωδικό για τον λογαριασμό σου."
              : mode === "signup"
                ? "Ξεκινάς με έναν καθαρό χώρο. Η παρέα και τα ταξίδια έρχονται μετά."
                : mode === "reset"
                  ? "Θα σου στείλουμε έναν σύνδεσμο για νέο κωδικό."
                  : "Συνδέσου για να συνεχίσεις τον σχεδιασμό με την παρέα σου."}
          </p>
          {invite && (
            <div className="invite-hint">
              <Link2 size={17} /> Έχεις μια πρόσκληση. Συνδέσου για να την
              αποδεχτείς.
            </div>
          )}
          {configurationError && <Notice>{configurationError}</Notice>}
          {error && <Notice>{error}</Notice>}
          {message && <Notice success>{message}</Notice>}
          {!recovery && mode !== "reset" && (
            <>
              <button
                type="button"
                className="button google-button full"
                disabled={busy || !!configurationError}
                aria-busy={googleBusy}
                onClick={() => void continueWithGoogle()}
              >
                {googleBusy ? (
                  <LoaderCircle className="spin" size={20} aria-hidden="true" />
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.73-.06-1.42-.19-2.09H12v3.96h5.92a5.07 5.07 0 0 1-2.2 3.33v2.77h3.56c2.08-1.92 3.28-4.75 3.28-7.97Z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.77c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09a6.6 6.6 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84Z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.54 10.54 0 0 0 12 1a11 11 0 0 0-9.82 6.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
                    />
                  </svg>
                )}
                {googleBusy ? "Μεταφορά στη Google…" : "Συνέχεια με Google"}
              </button>
              <div className="auth-divider">
                <span>ή με email</span>
              </div>
            </>
          )}
          <form onSubmit={submit}>
            {!recovery && (
              <label>
                Email
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </label>
            )}
            {(recovery || mode !== "reset") && (
              <label>
                Κωδικός
                <input
                  type="password"
                  autoComplete={
                    mode === "signup" || recovery
                      ? "new-password"
                      : "current-password"
                  }
                  minLength={mode === "signup" || recovery ? 8 : undefined}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    mode === "signup" || recovery
                      ? "Τουλάχιστον 8 χαρακτήρες"
                      : "Ο κωδικός σου"
                  }
                />
              </label>
            )}
            {mode === "login" && !recovery && (
              <button
                type="button"
                className="text-button forgot"
                disabled={busy}
                onClick={() => {
                  setMode("reset");
                  setError("");
                  setMessage("");
                }}
              >
                Ξέχασες τον κωδικό;
              </button>
            )}
            <button
              className="button primary full"
              disabled={busy || !!configurationError}
            >
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <ArrowRight size={18} />
              )}{" "}
              {recovery
                ? "Αποθήκευση κωδικού"
                : mode === "signup"
                  ? "Δημιουργία λογαριασμού"
                  : mode === "reset"
                    ? "Αποστολή συνδέσμου"
                    : "Σύνδεση"}
            </button>
          </form>
          {!recovery && (
            <p className="auth-switch">
              {mode === "login"
                ? "Πρώτη φορά εδώ;"
                : mode === "signup"
                  ? "Έχεις ήδη λογαριασμό;"
                  : "Θυμήθηκες τον κωδικό;"}{" "}
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setMode(mode === "login" ? "signup" : "login");
                  setError("");
                  setMessage("");
                }}
              >
                {mode === "login" ? "Δημιούργησε λογαριασμό" : "Συνδέσου"}
              </button>
            </p>
          )}
          <div className="privacy-note">
            <ShieldCheck size={20} />
            <span>
              Κάθε ομάδα έχει τον δικό της ιδιωτικό χώρο.
              <br />
              Πρόσβαση αποκτούν μόνο τα μέλη της.
              <br />
              <a href={`${import.meta.env.BASE_URL}privacy.html`}>
                Πολιτική απορρήτου
              </a>
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const invite = useSyncExternalStore(subscribeInvite, pendingInvite);
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [recovery, setRecovery] = useState(false);
  const [authError, setAuthError] = useState("");
  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }
    let alive = true;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      if (!alive) return;
      setSession(next);
      setChecking(false);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_OUT") {
        routeTo();
        setRecovery(false);
      }
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return;
      if (error) setAuthError(explainError(error));
      setSession(data.session);
      setChecking(false);
    });
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);
  if (checking)
    return (
      <div className="initial-loading">
        <Brand />
        <Loading text="Ανοίγουμε τον χώρο σου…" />
      </div>
    );
  if (!session || recovery)
    return (
      <>
        {authError && <Notice>{authError}</Notice>}
        <Auth
          invite={invite}
          recovery={recovery}
          onRecoveryDone={() => setRecovery(false)}
        />
      </>
    );
  return <Dashboard key={session.user.id} session={session} invite={invite} />;
}

function Dashboard({
  session,
  invite,
}: {
  session: Session;
  invite: string;
}) {
  const [revision, setRevision] = useState(0);
  const [groupId, setGroupId] = useState(
    () => new URLSearchParams(location.search).get("group") ?? "",
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inviteBanner = useRef<HTMLElement>(null);
  useEffect(() => {
    if (invite) {
      setError("");
      inviteBanner.current?.scrollIntoView({ block: "nearest" });
    }
  }, [invite]);
  const state = useAsyncData(
    (signal) => api.getGroups(signal),
    [session.user.id, revision],
  );
  const groups = state.data ?? [];
  const selected = groups.find((g) => g.id === groupId);
  const refresh = () => setRevision((v) => v + 1);
  function selectGroup(id: string) {
    setGroupId(id);
    setNavOpen(false);
    routeTo(id);
    setError("");
  }
  async function accept() {
    const attemptedToken = invite;
    if (!attemptedToken) return;
    setBusy(true);
    setError("");
    try {
      const id = await api.acceptInvitation(attemptedToken);
      if (pendingInvite() === attemptedToken) storeInvite("");
      setGroupId(id);
      routeTo(id);
      refresh();
    } catch (err) {
      const message = (err as { message?: string })?.message ?? "";
      if (pendingInvite() === attemptedToken) {
        setError(explainError(err));
        if (
          /invitation unavailable|invalid.*invit|invit.*(invalid|expired|revoked)|already.*member/i.test(message)
        ) {
          storeInvite("");
        }
      }
      refresh();
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    setError("");
    storeInvite("");
    setGroupId("");
    routeTo();
    try {
      const { error } = await requireClient().auth.signOut({ scope: "local" });
      if (error) throw error;
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app-shell">
      <aside className={`sidebar ${navOpen ? "open" : ""}`}>
        <Brand />
        <button
          className={`nav-item ${!selected ? "active" : ""}`}
          onClick={() => selectGroup("")}
        >
          <Compass size={19} /> Τα ταξίδια μου
        </button>
        <div className="sidebar-label">
          ΟΙ ΠΑΡΕΕΣ ΜΟΥ
          <button
            className="icon-button"
            aria-label="Νέα ομάδα"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="group-nav">
          {groups.map((group) => (
            <button
              className={`nav-item ${groupId === group.id ? "active" : ""}`}
              key={group.id}
              onClick={() => selectGroup(group.id)}
            >
              <span className="group-letter">
                {group.name.slice(0, 1).toUpperCase()}
              </span>
              <span>{group.name}</span>
            </button>
          ))}
          {!groups.length && (
            <p className="sidebar-empty">
              Η επόμενη παρέα
              <br />
              περιμένει εσένα.
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="private-card">
            <ShieldCheck size={21} />
            <strong>Μόνο για την παρέα</strong>
            <p>Οι ιδέες και τα ταξίδια σας είναι ιδιωτικά.</p>
          </div>
          <div className="user-row">
            <span className="avatar">
              {(session.user.email ?? "Ε").slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>Ο λογαριασμός σου</strong>
              <span title={session.user.email}>{session.user.email}</span>
            </div>
            <button
              className="icon-button"
              disabled={busy}
              onClick={logout}
              title="Αποσύνδεση"
              aria-label="Αποσύνδεση"
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      {navOpen && (
        <button
          className="nav-backdrop"
          onClick={() => setNavOpen(false)}
          aria-label="Κλείσιμο πλοήγησης"
        />
      )}
      <main className="main-content">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-menu"
              aria-label="Άνοιγμα πλοήγησης"
              onClick={() => setNavOpen(true)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              Ο χώρος σου{" "}
              {selected && (
                <>
                  <ChevronRight size={14} />
                  <strong>{selected.name}</strong>
                </>
              )}
            </span>
          </div>
          <span className="private-label">
            <LockKeyhole size={13} /> Ιδιωτικός χώρος
          </span>
        </header>
        <div className="content-wrap">
          {error && <Notice>{error}</Notice>}
          {invite && (
            <section className="invite-banner" ref={inviteBanner}>
              <div className="invite-banner-icon">
                <Link2 size={24} />
              </div>
              <div>
                <h3>Η παρέα σε περιμένει</h3>
                <p>
                  Αποδέξου την πρόσκληση για να αποκτήσεις πρόσβαση στην ομάδα.
                </p>
              </div>
              <button
                className="button primary"
                onClick={accept}
                disabled={busy}
              >
                Αποδοχή <ArrowRight size={16} />
              </button>
              <button
                className="icon-button"
                onClick={() => {
                  storeInvite("");
                }}
                aria-label="Απόρριψη πρόσκλησης"
              >
                <X size={19} />
              </button>
            </section>
          )}
          {state.loading ? (
            <Loading />
          ) : state.error ? (
            <>
              <Notice>{state.error}</Notice>
              <button className="button secondary" onClick={refresh}>
                Δοκίμασε ξανά
              </button>
            </>
          ) : selected ? (
            <GroupWorkspace
              key={selected.id}
              group={selected}
              userId={session.user.id}
              onBack={() => selectGroup("")}
              onAccessLost={() => {
                selectGroup("");
                refresh();
              }}
            />
          ) : (
            <>
              <section className="welcome">
                <div>
                  <span className="eyebrow">
                    ΛΙΓΗ ΟΡΓΑΝΩΣΗ. ΠΟΛΛΕΣ ΑΝΑΜΝΗΣΕΙΣ.
                  </span>
                  <h1>Πού πάμε μετά;</h1>
                  <p>
                    Μάζεψε την παρέα, κράτα τις ιδέες σας
                    <br className="desktop-break" /> και δώστε σχήμα στο επόμενο
                    ταξίδι.
                  </p>
                  <button
                    className="button primary"
                    onClick={() => setCreateOpen(true)}
                  >
                    <Plus size={18} /> Δημιουργία ομάδας
                  </button>
                </div>
                <JourneyArt />
              </section>
              <div className="section-title">
                <div>
                  <h2>
                    Οι παρέες σου <span className="count">{groups.length}</span>
                  </h2>
                  <p>Κάθε ομάδα, ένας κοινός χώρος για να σχεδιάζετε μαζί.</p>
                </div>
                {groups.length > 0 && (
                  <button
                    className="button secondary compact"
                    onClick={() => setCreateOpen(true)}
                  >
                    <Plus size={17} /> Νέα ομάδα
                  </button>
                )}
              </div>
              {groups.length ? (
                <div className="group-grid">
                  {groups.map((group, i) => (
                    <button
                      className="group-card"
                      key={group.id}
                      onClick={() => selectGroup(group.id)}
                    >
                      <div className={`group-cover cover-${i % 3}`}>
                        <Users size={39} strokeWidth={1.2} />
                        <span className="card-lock">
                          <LockKeyhole size={12} /> Ιδιωτική ομάδα
                        </span>
                        <div className="cover-orbit" />
                      </div>
                      <div className="group-card-body">
                        <div>
                          <h3>{group.name}</h3>
                          <p>Ανοίξτε τον χάρτη της παρέας σας</p>
                        </div>
                        <span className="round-arrow">
                          <ArrowUp size={19} />
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <section className="empty-state">
                  <span className="empty-icon">
                    <Users size={30} strokeWidth={1.4} />
                  </span>
                  <h3>Όλα αρχίζουν με μια παρέα</h3>
                  <p>
                    Δεν έχεις κάποια ομάδα ακόμα. Δημιούργησε μία ή
                    <br className="desktop-break" /> ζήτησε μια πρόσκληση από
                    την παρέα σου.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => setCreateOpen(true)}
                  >
                    Φτιάξε την πρώτη σου ομάδα <ArrowRight size={16} />
                  </button>
                  <div className="empty-note">
                    <Check size={14} /> Καθαρός χώρος, μόνο με τις δικές σας
                    ιδέες
                  </div>
                </section>
              )}
              <div className="tip-row">
                <span>
                  <Sparkles size={18} />
                </span>
                <p>
                  <strong>Κάθε ταξίδι είναι μια νέα αρχή.</strong> Ξεκινήστε από
                  το μηδέν ή προσθέστε μόνο δύο στάσεις: Σαγκάη και Πεκίνο.
                </p>
              </div>
            </>
          )}
        </div>
        <footer className="page-footer" role="contentinfo">
          <span>
            Group Trip Planner
            <br />
            <a href={`${import.meta.env.BASE_URL}privacy.html`}>
              Πολιτική απορρήτου
            </a>
          </span>
          <span>Φτιαγμένο για όσα θα θυμάστε μαζί.</span>
        </footer>
      </main>
      {createOpen && (
        <CreateGroupModal
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false);
            setGroupId(id);
            routeTo(id);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function CreateGroupModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef({ id: uid(), name: "" });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const clean = name.trim();
    if (request.current.name !== clean)
      request.current = { id: uid(), name: clean };
    try {
      onCreated(await api.createGroup(clean, request.current.id));
    } catch (err) {
      setError(explainError(err));
      setBusy(false);
    }
  }
  return (
    <Modal title="Μια νέα παρέα" onClose={onClose} busy={busy}>
      <p className="muted">
        Δώσε ένα όνομα στην ομάδα. Μετά μπορείτε να προσθέσετε ταξίδια και να
        καλέσετε τα μέλη σας.
      </p>
      {error && <Notice>{error}</Notice>}
      <form onSubmit={submit}>
        <label>
          Όνομα ομάδας
          <input
            autoFocus
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="π.χ. Η ταξιδιάρικη παρέα"
          />
        </label>
        <div className="privacy-inline">
          <LockKeyhole size={16} /> Η ομάδα είναι ιδιωτική από την αρχή.
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Ακύρωση
          </button>
          <button className="button primary" disabled={busy || !name.trim()}>
            {busy && <LoaderCircle className="spin" size={17} />} Δημιουργία
            ομάδας
          </button>
        </div>
      </form>
    </Modal>
  );
}
function TripCreateModal({
  groupId,
  onClose,
  onCreated,
}: {
  groupId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<"blank" | "china">("blank");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef({ id: uid(), fingerprint: "" });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fingerprint = JSON.stringify([name.trim(), template]);
    if (request.current.fingerprint !== fingerprint)
      request.current = { id: uid(), fingerprint };
    try {
      onCreated(
        await api.createTrip(
          groupId,
          name.trim(),
          template,
          request.current.id,
        ),
      );
    } catch (err) {
      setError(explainError(err));
      setBusy(false);
    }
  }
  return (
    <Modal title="Πού θα πάει η παρέα;" onClose={onClose} busy={busy}>
      <p className="muted">Ένα νέο ταξίδι, στον ιδιωτικό χώρο της ομάδας.</p>
      {error && <Notice>{error}</Notice>}
      <form onSubmit={submit}>
        <label>
          Όνομα ταξιδιού
          <input
            autoFocus
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="π.χ. Η επόμενη περιπέτειά μας"
          />
        </label>
        <fieldset>
          <legend>Πώς θέλετε να ξεκινήσετε;</legend>
          <label
            className={`template-option ${template === "blank" ? "selected" : ""}`}
          >
            <input
              type="radio"
              name="template"
              checked={template === "blank"}
              onChange={() => setTemplate("blank")}
            />
            <span>
              <strong>Από την αρχή</strong>
              <small>Κενό ταξίδι, για τις δικές σας στάσεις και ιδέες.</small>
            </span>
            <Compass size={22} />
          </label>
          <label
            className={`template-option ${template === "china" ? "selected" : ""}`}
          >
            <input
              type="radio"
              name="template"
              checked={template === "china"}
              onChange={() => setTemplate("china")}
            />
            <span>
              <strong>Σαγκάη & Πεκίνο</strong>
              <small>
                Μόνο δύο στάσεις. Χωρίς έτοιμες προτάσεις ή άλλο περιεχόμενο.
              </small>
            </span>
            <Globe2 size={22} />
          </label>
        </fieldset>
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Ακύρωση
          </button>
          <button className="button primary" disabled={busy || !name.trim()}>
            {busy && <LoaderCircle className="spin" size={17} />} Δημιουργία
            ταξιδιού
          </button>
        </div>
      </form>
    </Modal>
  );
}

function GroupWorkspace({
  group,
  userId,
  onBack,
  onAccessLost,
}: {
  group: api.Group;
  userId: string;
  onBack: () => void;
  onAccessLost: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const [tripId, setTripId] = useState(
    () => new URLSearchParams(location.search).get("trip") ?? "",
  );
  const [tab, setTab] = useState<"trips" | "members">("trips");
  const [modal, setModal] = useState<"create" | "import" | "invite" | null>(
    null,
  );
  const [error, setError] = useState("");
  const state = useAsyncData(
    (signal) => api.getGroupData(group.id, signal),
    [group.id, revision],
  );
  const members = state.data?.members ?? [];
  const me = members.find((m) => m.user_id === userId);
  const isAdmin = me?.role === "owner" || me?.role === "admin";
  const trips = state.data?.trips ?? [];
  const trip = trips.find((t) => t.id === tripId);
  useEffect(() => {
    if (
      !state.loading &&
      !state.error &&
      state.data &&
      !state.data.members.some((m) => m.user_id === userId)
    )
      onAccessLost();
  }, [state.data, state.loading, state.error, userId]);
  function openTrip(id: string) {
    setTripId(id);
    routeTo(group.id, id);
  }
  function created(id: string) {
    setModal(null);
    setTripId(id);
    routeTo(group.id, id);
    setRevision((v) => v + 1);
  }
  if (state.loading) return <Loading />;
  if (state.error)
    return (
      <>
        <Notice>{state.error}</Notice>
        <button
          className="button secondary"
          onClick={() => setRevision((v) => v + 1)}
        >
          Δοκίμασε ξανά
        </button>
      </>
    );
  if (trip)
    return (
      <TripWorkspace
        key={trip.id}
        trip={trip}
        userId={userId}
        members={members}
        isAdmin={isAdmin}
        onBack={() => {
          setTripId("");
          routeTo(group.id);
        }}
        onAccessLost={onAccessLost}
      />
    );
  return (
    <>
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={15} /> Όλες οι παρέες
      </button>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Ο ΔΙΚΟΣ ΣΑΣ ΚΟΙΝΟΣ ΧΩΡΟΣ</span>
          <h1>{group.name}</h1>
          <p>
            <Users size={16} /> {members.length}{" "}
            {members.length === 1 ? "μέλος" : "μέλη"}{" "}
            <span className="dot">·</span>
            <LockKeyhole size={14} /> Ιδιωτική ομάδα
          </p>
        </div>
        {isAdmin && (
          <button
            className="button secondary"
            onClick={() => setModal("invite")}
          >
            <Link2 size={17} /> Πρόσκληση παρέας
          </button>
        )}
      </div>
      <div className="tabs">
        <button
          className={tab === "trips" ? "active" : ""}
          onClick={() => setTab("trips")}
        >
          <Compass size={17} /> Ταξίδια <span>{trips.length}</span>
        </button>
        <button
          className={tab === "members" ? "active" : ""}
          onClick={() => setTab("members")}
        >
          <Users size={17} /> Μέλη <span>{members.length}</span>
        </button>
      </div>
      {error && <Notice>{error}</Notice>}
      {tab === "trips" ? (
        <>
          <div className="section-title">
            <div>
              <h2>Οι επόμενες αναμνήσεις σας</h2>
              <p>Διαδρομές, προτάσεις και όλες οι λεπτομέρειες σε ένα μέρος.</p>
            </div>
            {isAdmin && (
              <div className="button-row">
                <button
                  className="button secondary compact"
                  onClick={() => setModal("import")}
                >
                  <Upload size={16} /> Εισαγωγή
                </button>
                <button
                  className="button primary compact"
                  onClick={() => setModal("create")}
                >
                  <Plus size={17} /> Νέο ταξίδι
                </button>
              </div>
            )}
          </div>
          {trips.length ? (
            <div className="trip-grid">
              {trips.map((t, i) => (
                <button
                  className="trip-card"
                  key={t.id}
                  onClick={() => openTrip(t.id)}
                >
                  <div className={`trip-illustration cover-${i % 3}`}>
                    <Route size={57} strokeWidth={1} />
                    <span className="label-pill">Σχεδιάζουμε μαζί</span>
                  </div>
                  <div className="trip-card-body">
                    <h3>{t.name}</h3>
                    <p>
                      <Globe2 size={14} /> {t.timezone.replaceAll("_", " ")}{" "}
                      <span>·</span> {t.currency}
                    </p>
                    <div className="trip-card-link">
                      Άνοιγμα ταξιδιού <ArrowRight size={17} />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <section className="empty-state">
              <span className="empty-icon">
                <Plane size={31} strokeWidth={1.4} />
              </span>
              <h3>Ο κόσμος σας περιμένει</h3>
              <p>
                {isAdmin
                  ? "Προσθέστε το πρώτο σας ταξίδι και αρχίστε να κρατάτε ιδέες."
                  : "Ένας διαχειριστής μπορεί να δημιουργήσει το πρώτο ταξίδι της ομάδας."}
              </p>
              {isAdmin && (
                <button
                  className="button primary"
                  onClick={() => setModal("create")}
                >
                  <Plus size={17} /> Πρώτο ταξίδι
                </button>
              )}
            </section>
          )}
        </>
      ) : (
        <Members
          members={members}
          userId={userId}
          groupId={group.id}
          isAdmin={isAdmin}
          onChange={() => setRevision((v) => v + 1)}
          onError={setError}
        />
      )}
      {modal === "create" && (
        <TripCreateModal
          groupId={group.id}
          onClose={() => setModal(null)}
          onCreated={created}
        />
      )}
      {modal === "import" && (
        <ImportModal
          groupId={group.id}
          groupName={group.name}
          onClose={() => setModal(null)}
          onCreated={created}
        />
      )}
      {modal === "invite" && (
        <InviteModal groupId={group.id} onClose={() => setModal(null)} />
      )}
    </>
  );
}

function Members({
  members,
  userId,
  groupId,
  isAdmin,
  onChange,
  onError,
}: {
  members: api.Member[];
  userId: string;
  groupId: string;
  isAdmin: boolean;
  onChange: () => void;
  onError: (error: string) => void;
}) {
  const [removing, setRemoving] = useState<api.Member | null>(null);
  const [busy, setBusy] = useState(false);
  const myRole = members.find((m) => m.user_id === userId)?.role;
  const [displayName, setDisplayName] = useState(
    () => members.find((m) => m.user_id === userId)?.display_name ?? "",
  );
  async function saveName(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError("");
    try {
      await setMemberDisplayName(groupId, displayName.trim());
      onChange();
    } catch (err) {
      onError(explainError(err));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.removeMember(groupId, removing.user_id);
      setRemoving(null);
      onChange();
    } catch (err) {
      onError(explainError(err));
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="section-title">
        <div>
          <h2>Η παρέα πίσω από το ταξίδι</h2>
          <p>Η συμμετοχή σε κάθε ταξίδι ορίζεται ξεχωριστά.</p>
        </div>
      </div>
      <div className="members-list">
        {members.map((m, i) => (
          <div className="member-row" key={m.user_id}>
            <span className={`avatar color-${i % 3}`}>
              {m.user_id === userId ? "Ε" : String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <strong>{displayMember(members, m.user_id, userId)}</strong>
              <small>
                {m.user_id === userId
                  ? "Ο λογαριασμός σου"
                  : `Αναγνωριστικό: ${m.user_id.slice(0, 8)}`}
              </small>
            </div>
            <span className="role-badge">
              {m.role === "owner"
                ? "Ιδιοκτήτης"
                : m.role === "admin"
                  ? "Διαχειριστής"
                  : "Μέλος"}
            </span>
            {isAdmin &&
              m.user_id !== userId &&
              m.role !== "owner" &&
              (myRole === "owner" || m.role === "member") && (
                <button
                  className="icon-button danger"
                  aria-label={`Αφαίρεση μέλους ${m.user_id.slice(0, 8)}`}
                  onClick={() => setRemoving(m)}
                >
                  <Trash2 size={17} />
                </button>
              )}
          </div>
        ))}
      </div>
      <form className="member-name-form" onSubmit={saveName}>
        <label>
          Το όνομά σου στην παρέα
          <input
            maxLength={80}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Πώς θέλεις να σε βλέπει η παρέα;"
          />
        </label>
        <button className="button secondary compact" disabled={busy}>
          Αποθήκευση ονόματος
        </button>
      </form>
      <p className="privacy-inline">
        <ShieldCheck size={16} /> Τα email των άλλων μελών δεν εμφανίζονται.
      </p>
      {removing && (
        <Modal
          title="Αφαίρεση μέλους;"
          busy={busy}
          onClose={() => setRemoving(null)}
        >
          <p>
            Το μέλος {removing.user_id.slice(0, 8)} θα χάσει πρόσβαση σε όλα τα
            ταξίδια και τις πληροφορίες της ομάδας. Οι καταχωρίσεις του θα
            παραμείνουν.
          </p>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setRemoving(null)}
              disabled={busy}
            >
              Ακύρωση
            </button>
            <button
              className="button danger-button"
              onClick={remove}
              disabled={busy}
            >
              Αφαίρεση μέλους
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function InviteModal({
  groupId,
  onClose,
}: {
  groupId: string;
  onClose: () => void;
}) {
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const state = useAsyncData(
    () => api.getInvitations(groupId),
    [groupId, revision],
  );
  async function create() {
    setBusy(true);
    setError("");
    setLink("");
    try {
      const token = await api.createInvitation(groupId);
      const url = new URL(location.origin + location.pathname);
      url.hash = new URLSearchParams({ invite: token }).toString();
      setLink(url.toString());
      setCopied(false);
      setRevision((v) => v + 1);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError(
        "Η αντιγραφή δεν ήταν διαθέσιμη. Επίλεξε και αντέγραψε τον σύνδεσμο από το πεδίο.",
      );
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    setError("");
    try {
      await api.revokeInvitation(id);
      setLink("");
      setRevision((v) => v + 1);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }
  const active = (state.data ?? []).filter(
    (i) =>
      !i.revoked_at && !i.accepted_at && Date.parse(i.expires_at) > Date.now(),
  );
  return (
    <Modal title="Κάλεσε την παρέα σου" busy={busy} onClose={onClose}>
      <div className="dialog-illustration">
        <Link2 size={30} />
      </div>
      <p className="muted">
        Κάθε σύνδεσμος ισχύει για 7 ημέρες και μπορεί να χρησιμοποιηθεί από ένα
        νέο μέλος. Το μέλος συνδέεται πριν αποκτήσει πρόσβαση.
      </p>
      {error && <Notice>{error}</Notice>}
      {link ? (
        <>
          <label>
            Ο σύνδεσμος πρόσκλησης
            <input value={link} readOnly onFocus={(e) => e.target.select()} />
          </label>
          <button className="button primary full" onClick={copy}>
            {copied ? <Check size={17} /> : <Copy size={17} />}{" "}
            {copied ? "Αντιγράφηκε" : "Αντιγραφή συνδέσμου"}
          </button>
          <p className="field-hint">
            Μοιράσου τον μόνο με το μέλος που θέλεις να καλέσεις. Δεν
            εμφανίζεται ξανά αφού κλείσεις αυτό το παράθυρο.
          </p>
        </>
      ) : (
        <button
          className="button primary full"
          onClick={create}
          disabled={busy}
        >
          {busy ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Plus size={17} />
          )}{" "}
          Δημιουργία πρόσκλησης
        </button>
      )}
      <div className="invite-history">
        <h3>Ενεργές προσκλήσεις</h3>
        {state.loading ? (
          <Loading text="Φόρτωση προσκλήσεων…" />
        ) : state.error ? (
          <Notice>{state.error}</Notice>
        ) : active.length ? (
          active.map((inv) => (
            <div className="invite-history-row" key={inv.id}>
              <div>
                <strong>Πρόσκληση {inv.id.slice(0, 6)}</strong>
                <span>
                  Λήγει {new Date(inv.expires_at).toLocaleDateString("el-GR")}
                </span>
              </div>
              <button
                className="text-button danger"
                disabled={busy}
                onClick={() => revoke(inv.id)}
              >
                Ανάκληση
              </button>
            </div>
          ))
        ) : (
          <p className="muted">Δεν υπάρχουν ενεργές προσκλήσεις.</p>
        )}
      </div>
    </Modal>
  );
}

function ImportModal({
  groupId,
  groupName,
  onClose,
  onCreated,
}: {
  groupId: string;
  groupName: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [payload, setPayload] = useState<PrivateTripImport | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef(uid());
  async function choose(file?: File) {
    setPayload(null);
    setError("");
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_BYTES)
        throw new Error("Το αρχείο ξεπερνά το όριο των 2 MiB.");
      const parsed = parsePrivateImport(await file.text());
      setPayload(parsed);
      setFileName(file.name);
      request.current = uid();
    } catch (err) {
      setError(explainError(err));
    }
  }
  async function confirm() {
    if (!payload) return;
    setBusy(true);
    setError("");
    try {
      onCreated(await api.importPrivateTrip(groupId, payload, request.current));
    } catch (err) {
      setError(explainError(err));
      setBusy(false);
    }
  }
  const summary = payload ? getImportSummary(payload) : null;
  return (
    <Modal title="Οι ιδέες σας, όλες μαζί" busy={busy} onClose={onClose}>
      <p className="muted">
        Εισήγαγε το ιδιωτικό αρχείο ταξιδιού JSON. Θα δημιουργηθεί νέο ταξίδι
        μόνο στην ομάδα <strong>{groupName}</strong>.
      </p>
      {error && <Notice>{error}</Notice>}
      <label className="upload-zone">
        <Upload size={27} />
        <strong>{fileName || "Επίλεξε το αρχείο ταξιδιού"}</strong>
        <span>Αρχείο JSON · έως 2 MiB</span>
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(e) => void choose(e.target.files?.[0])}
        />
      </label>
      {summary && (
        <div className="import-preview">
          <span className="eyebrow">ΠΡΟΕΠΙΣΚΟΠΗΣΗ</span>
          <h3>{summary.name}</h3>
          <div className="import-counts">
            <div>
              <strong>{summary.stops}</strong>
              <span>στάσεις</span>
            </div>
            <div>
              <strong>{summary.activities}</strong>
              <span>προτάσεις</span>
            </div>
            <div>
              <strong>{summary.lodgings}</strong>
              <span>διαμονές</span>
            </div>
            <div>
              <strong>{summary.transfers}</strong>
              <span>μετακινήσεις</span>
            </div>
          </div>
          <p>
            <LockKeyhole size={14} /> Πρόσβαση μόνο στα μέλη της ομάδας «
            {groupName}».
          </p>
        </div>
      )}
      <div className="modal-actions">
        <button className="button secondary" disabled={busy} onClick={onClose}>
          Ακύρωση
        </button>
        <button
          className="button primary"
          disabled={busy || !payload}
          onClick={confirm}
        >
          {busy ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Download size={17} />
          )}{" "}
          Επιβεβαίωση εισαγωγής
        </button>
      </div>
    </Modal>
  );
}

const ITEM_LABELS = {
  activities: "Προτάσεις",
  lodgings: "Διαμονή",
  transfers: "Μετακινήσεις",
};
const ITEM_SINGULAR = {
  activities: "πρόταση",
  lodgings: "διαμονή",
  transfers: "μετακίνηση",
};
function TripWorkspace({
  trip,
  userId,
  members,
  isAdmin,
  onBack,
  onAccessLost,
}: {
  trip: api.Trip;
  userId: string;
  members: api.Member[];
  isAdmin: boolean;
  onBack: () => void;
  onAccessLost: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<api.ItemTable>("activities");
  const [view, setView] = useState<"ideas" | "preferences" | "plan">("ideas");
  const [collaborationRevision, setCollaborationRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [stopFilter, setStopFilter] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editStop, setEditStop] = useState<api.Stop | "new" | null>(null);
  const [editItem, setEditItem] = useState<api.Item | "new" | null>(null);
  const [detail, setDetail] = useState<api.Item | null>(null);
  const [tripInfo, setTripInfo] = useState(false);
  const [deleting, setDeleting] = useState<{
    type: "stop" | "item";
    record: api.Stop | api.Item;
  } | null>(null);
  const state = useAsyncData(
    async (signal) => {
      const group = await api.getGroupData(trip.group_id, signal);
      const currentTrip = group.trips.find((t) => t.id === trip.id);
      if (!group.members.some((m) => m.user_id === userId) || !currentTrip) {
        if (!signal.aborted) onAccessLost();
        throw new Error("Δεν έχεις πλέον πρόσβαση σε αυτό το ταξίδι.");
      }
      const content = await api.getTripData(trip.id, signal);
      return { ...content, trip: currentTrip, members: group.members };
    },
    [trip.id, revision],
  );
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        view !== "plan" &&
        !editItem &&
        !editStop &&
        !detail &&
        !tripInfo &&
        !deleting
      )
        setRevision((v) => v + 1);
    }, 60000);
    return () => clearInterval(interval);
  }, [editItem, editStop, detail, tripInfo, deleting, view]);
  const refresh = () => {
    setEditItem(null);
    setEditStop(null);
    setDeleting(null);
    setDetail(null);
    setRevision((v) => v + 1);
  };
  const data = state.data;
  const currentMembers = data?.members ?? members;
  if (data)
    isAdmin = data.members.some(
      (member) =>
        member.user_id === userId && ["owner", "admin"].includes(member.role),
    );
  const stops = data?.stops ?? [];
  const allItems = data?.[tab] ?? [];
  const items = allItems.filter(
    (item) =>
      (!stopFilter || item.stop_id === stopFilter) &&
      `${item.title} ${item.description ?? ""} ${item.why_visit ?? ""} ${getItemPresentation(item.details).location} ${getItemPresentation(item.details).category}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  const status =
    data?.participants.find((p) => p.user_id === userId)?.status ?? "undecided";
  const going =
    data?.participants.filter(
      (p) =>
        p.status === "going" &&
        currentMembers.some((member) => member.user_id === p.user_id),
    ).length ?? 0;
  async function participation(value: string) {
    setBusy(true);
    setError("");
    try {
      await api.setParticipation(trip.id, value);
      refresh();
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }
  async function reorder(stop: api.Stop, direction: -1 | 1) {
    const index = stops.findIndex((s) => s.id === stop.id);
    const other = stops[index + direction];
    if (!other || !data) return;
    const ordered = stops.map((s) => s.id);
    [ordered[index], ordered[index + direction]] = [
      ordered[index + direction],
      ordered[index],
    ];
    setBusy(true);
    setError("");
    try {
      await api.reorderStops(trip.id, ordered, data.trip.version);
      refresh();
    } catch (err) {
      setError(explainError(err));
      refresh();
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setError("");
    try {
      if (deleting.type === "stop")
        await api.deleteStop(deleting.record as api.Stop);
      else await api.deleteItem(tab, deleting.record as api.Item);
      refresh();
    } catch (err) {
      setError(explainError(err));
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={15} /> Τα ταξίδια της παρέας
      </button>
      <div className="trip-heading">
        <div>
          <span className="eyebrow">ΤΟ ΕΠΟΜΕΝΟ ΚΕΦΑΛΑΙΟ ΣΑΣ</span>
          <h1>{trip.name}</h1>
          <p>
            <Globe2 size={15} /> {trip.timezone.replaceAll("_", " ")}
            <span className="dot">·</span>
            {trip.currency}
            <span className="dot">·</span>
            <Users size={15} /> {going} από {currentMembers.length} θα έρθουν
          </p>
        </div>
        <div className="participation">
          <label htmlFor="participation">Εσύ θα έρθεις;</label>
          <select
            id="participation"
            value={status}
            disabled={busy || state.loading}
            onChange={(e) => void participation(e.target.value)}
          >
            <option value="going">Ναι, μέσα!</option>
            <option value="undecided">Το σκέφτομαι</option>
            <option value="not_going">Αυτή τη φορά όχι</option>
          </select>
        </div>
      </div>
      {data?.trip.details && Object.keys(data.trip.details).length > 0 && (
        <button
          className="button secondary trip-info-button"
          onClick={() => setTripInfo(true)}
        >
          <CircleHelp size={16} /> Πληροφορίες ταξιδιού
        </button>
      )}
      {tripInfo && (
        <Modal
          title="Πληροφορίες ταξιδιού"
          wide
          onClose={() => setTripInfo(false)}
        >
          <p className="muted">
            Το εισαγόμενο πρόγραμμα και οι πηγές αποτυπώνουν τον αρχικό
            σχεδιασμό της παρέας. Είναι ιστορικό προσχέδιο, χωρίς αυτόματη
            επικαιροποίηση ή νέα επιβεβαίωση.
          </p>
          <Metadata value={data?.trip.details} />
        </Modal>
      )}
      {error && <Notice>{error}</Notice>}
      {state.error && (
        <>
          <Notice>{state.error}</Notice>
          <button className="button secondary" onClick={refresh}>
            Ανανέωση
          </button>
        </>
      )}
      {state.loading ? (
        <Loading />
      ) : (
        data && (
          <>
            <section className="route-section">
              <div className="section-title">
                <div>
                  <h2>
                    <Route size={19} /> Η διαδρομή μας
                  </h2>
                  <p>Οι στάσεις που θα γεμίσουν αναμνήσεις.</p>
                </div>
                {isAdmin && (
                  <button
                    className="button secondary compact"
                    onClick={() => setEditStop("new")}
                  >
                    <Plus size={15} /> Στάση
                  </button>
                )}
              </div>
              {stops.length ? (
                <div className="stops-row">
                  {stops.map((stop, index) => (
                    <div className="stop-card" key={stop.id}>
                      <div className="stop-top">
                        <span className="stop-number">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <MapPin size={19} />
                      </div>
                      <h3>{stop.name}</h3>
                      <p>
                        {
                          data.activities.filter((a) => a.stop_id === stop.id)
                            .length
                        }{" "}
                        προτάσεις
                      </p>
                      {isAdmin && (
                        <div className="stop-actions">
                          <button
                            className="icon-button"
                            disabled={busy || index === 0}
                            aria-label={`Μετακίνηση ${stop.name} νωρίτερα`}
                            onClick={() => void reorder(stop, -1)}
                          >
                            <ArrowLeft size={14} />
                          </button>
                          <button
                            className="icon-button"
                            disabled={busy || index === stops.length - 1}
                            aria-label={`Μετακίνηση ${stop.name} αργότερα`}
                            onClick={() => void reorder(stop, 1)}
                          >
                            <ArrowRight size={14} />
                          </button>
                          <span />
                          <button
                            className="icon-button"
                            aria-label={`Επεξεργασία ${stop.name}`}
                            onClick={() => setEditStop(stop)}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="icon-button danger"
                            aria-label={`Διαγραφή ${stop.name}`}
                            onClick={() =>
                              setDeleting({ type: "stop", record: stop })
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-route">
                  <MapPin size={26} strokeWidth={1.3} />
                  <span>
                    Ο χάρτης είναι ακόμα ανοιχτός.
                    <br />
                    <strong>
                      {isAdmin
                        ? "Προσθέστε την πρώτη σας στάση."
                        : "Η παρέα σχεδιάζει την πρώτη στάση."}
                    </strong>
                  </span>
                </div>
              )}
            </section>
            <nav
              className="workspace-navigation"
              aria-label="Ενότητες ταξιδιού"
            >
              {(
                [
                  ["ideas", "Ιδέες"],
                  ["preferences", "Προτιμήσεις παρέας"],
                  ["plan", "Πρόγραμμα"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={view === key}
                  className={view === key ? "active" : ""}
                  onClick={() => setView(key)}
                >
                  {label}
                </button>
              ))}
            </nav>
            {view === "preferences" && (
              <PreferenceOverview
                key={collaborationRevision}
                tripId={trip.id}
                activities={data.activities}
                members={currentMembers}
                participants={data.participants}
                userId={userId}
                onAccessLost={onAccessLost}
                onOpen={(item) => {
                  setTab("activities");
                  setDetail(item);
                }}
              />
            )}
            {view === "plan" && (
              <TripPlanner
                trip={data.trip}
                activities={data.activities}
                stops={stops}
                members={currentMembers}
                participants={data.participants}
                userId={userId}
                isAdmin={isAdmin}
                onChanged={() => {}}
                onAccessLost={onAccessLost}
              />
            )}
            {view === "ideas" && (
              <>
                <div className="tabs content-tabs">
                  {(["activities", "lodgings", "transfers"] as const).map(
                    (key) => (
                      <button
                        key={key}
                        className={tab === key ? "active" : ""}
                        onClick={() => {
                          setTab(key);
                          setQuery("");
                          setStopFilter("");
                        }}
                      >
                        {key === "activities" ? (
                          <Sparkles size={16} />
                        ) : key === "lodgings" ? (
                          <Hotel size={16} />
                        ) : (
                          <TrainFront size={16} />
                        )}{" "}
                        {ITEM_LABELS[key]} <span>{data[key].length}</span>
                      </button>
                    ),
                  )}
                </div>
                <div className="catalog-toolbar">
                  <div className="search-field">
                    <Search size={17} />
                    <input
                      aria-label="Αναζήτηση καταχωρίσεων"
                      placeholder="Βρες μια ιδέα…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <select
                    className="stop-filter"
                    aria-label="Φίλτρο στάσης"
                    value={stopFilter}
                    onChange={(e) => setStopFilter(e.target.value)}
                  >
                    <option value="">Όλες οι στάσεις</option>
                    {stops.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  {(isAdmin || tab === "activities") && (
                    <button
                      className="button primary compact"
                      onClick={() => setEditItem("new")}
                    >
                      <Plus size={16} /> Νέα {ITEM_SINGULAR[tab]}
                    </button>
                  )}
                </div>
                {items.length ? (
                  <div className="idea-grid">
                    {items.map((item, i) => {
                      const editable =
                        isAdmin ||
                        (tab === "activities" && item.created_by === userId);
                      return (
                        <article className="idea-card" key={item.id}>
                          <button
                            className="idea-main"
                            onClick={() => setDetail(item)}
                          >
                            <div className="idea-card-top">
                              <span className={`idea-icon idea-${i % 3}`}>
                                {tab === "activities" ? (
                                  <Sparkles size={20} />
                                ) : tab === "lodgings" ? (
                                  <Hotel size={20} />
                                ) : (
                                  <TrainFront size={20} />
                                )}
                              </span>
                              <span className="stop-tag">
                                <MapPin size={12} />
                                {stops.find((s) => s.id === item.stop_id)
                                  ?.name ??
                                  (getItemPresentation(item.details).location ||
                                    "Χωρίς στάση")}
                              </span>
                            </div>
                            <h3>{item.title}</h3>
                            <p>
                              {item.description ||
                                item.why_visit ||
                                "Μια νέα ιδέα για το ταξίδι σας."}
                            </p>
                            {item.why_visit && (
                              <div className="why-visit">
                                <Heart size={13} />
                                <span>{item.why_visit}</span>
                              </div>
                            )}
                            <span className="details-link">
                              Δες λεπτομέρειες <ArrowRight size={14} />
                            </span>
                          </button>
                          {editable && (
                            <div className="idea-controls">
                              <button
                                className="icon-button"
                                aria-label={`Επεξεργασία ${item.title}`}
                                onClick={() => setEditItem(item)}
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                className="icon-button danger"
                                aria-label={`Διαγραφή ${item.title}`}
                                onClick={() =>
                                  setDeleting({ type: "item", record: item })
                                }
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <section className="empty-state compact-empty">
                    <span className="empty-icon">
                      <Sparkles size={28} strokeWidth={1.3} />
                    </span>
                    <h3>
                      {allItems.length
                        ? "Δεν βρήκαμε κάτι εδώ"
                        : "Μια ωραία ιδέα είναι η αρχή"}
                    </h3>
                    <p>
                      {allItems.length
                        ? "Δοκίμασε άλλη λέξη ή άλλαξε το φίλτρο στάσης."
                        : "Προσθέστε τις δικές σας προτάσεις για να τις βρει όλη η παρέα."}
                    </p>
                    {!allItems.length && (isAdmin || tab === "activities") && (
                      <button
                        className="text-button"
                        onClick={() => setEditItem("new")}
                      >
                        Προσθήκη {ITEM_SINGULAR[tab]} <ArrowRight size={16} />
                      </button>
                    )}
                  </section>
                )}
              </>
            )}
          </>
        )
      )}
      {editStop && (
        <StopModal
          tripId={trip.id}
          stop={editStop === "new" ? undefined : editStop}
          position={
            stops.length ? Math.max(...stops.map((s) => s.position)) + 1 : 0
          }
          onClose={() => setEditStop(null)}
          onSaved={refresh}
        />
      )}
      {editItem && (
        <ItemModal
          table={tab}
          tripId={trip.id}
          item={editItem === "new" ? undefined : editItem}
          stops={stops}
          currency={trip.currency}
          onClose={() => setEditItem(null)}
          onSaved={refresh}
        />
      )}
      {detail && (
        <Modal title={detail.title} wide onClose={() => setDetail(null)}>
          <div className="detail-tag">
            <MapPin size={14} />
            {stops.find((s) => s.id === detail.stop_id)?.name ?? "Χωρίς στάση"}
          </div>
          {detail.description && (
            <p className="detail-description">{detail.description}</p>
          )}
          {detail.why_visit && (
            <div className="detail-why">
              <Heart size={19} />
              <div>
                <h3>Γιατί αξίζει</h3>
                <p>{detail.why_visit}</p>
              </div>
            </div>
          )}
          <ItemInformation
            details={detail.details ?? {}}
            currency={trip.currency}
            title={detail.title}
          />
          {tab === "activities" && (
            <ActivityCollaboration
              key={detail.id}
              item={detail}
              tripId={trip.id}
              userId={userId}
              members={currentMembers}
              participants={data?.participants ?? []}
              isAdmin={isAdmin}
              onChanged={() => setCollaborationRevision((value) => value + 1)}
              onAccessLost={onAccessLost}
            />
          )}
          {Object.keys(detail.details ?? {}).some(
            (key) => key !== "presentation",
          ) && (
            <details className="detail-metadata original-reference">
              <summary>Αρχικά στοιχεία & πρόσθετες πληροφορίες</summary>
              <Metadata value={detail.details} />
            </details>
          )}
        </Modal>
      )}
      {deleting && (
        <Modal
          title={`Διαγραφή ${deleting.type === "stop" ? "στάσης" : "καταχώρισης"};`}
          busy={busy}
          onClose={() => setDeleting(null)}
        >
          <p>
            Θα διαγραφεί το «
            {"title" in deleting.record
              ? deleting.record.title
              : deleting.record.name}
            » για όλη την ομάδα.
            {deleting.type === "stop" &&
              " Αν υπάρχουν συνδεδεμένες καταχωρίσεις, άλλαξε πρώτα τη στάση τους."}
          </p>
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              Ακύρωση
            </button>
            <button
              className="button danger-button"
              disabled={busy}
              onClick={remove}
            >
              Διαγραφή
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function StopModal({
  tripId,
  stop,
  position,
  onClose,
  onSaved,
}: {
  tripId: string;
  stop?: api.Stop;
  position: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(stop?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef({ id: uid(), fingerprint: "" });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fingerprint = JSON.stringify([name.trim(), position]);
    if (request.current.fingerprint !== fingerprint)
      request.current = { id: uid(), fingerprint };
    try {
      if (stop) await api.updateStop(stop, { name: name.trim() });
      else await api.addStop(tripId, name.trim(), position, request.current.id);
      onSaved();
    } catch (err) {
      setError(explainError(err));
      setBusy(false);
    }
  }
  return (
    <Modal
      title={stop ? "Επεξεργασία στάσης" : "Ένας ακόμα προορισμός"}
      busy={busy}
      onClose={onClose}
    >
      {error && <Notice>{error}</Notice>}
      <form onSubmit={submit}>
        <label>
          Όνομα στάσης
          <input
            autoFocus
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Πόλη, νησί ή αγαπημένο μέρος"
          />
        </label>
        <div className="modal-actions">
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Ακύρωση
          </button>
          <button className="button primary" disabled={busy || !name.trim()}>
            {busy && <LoaderCircle className="spin" size={16} />} Αποθήκευση
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ItemModal({
  table,
  tripId,
  item,
  stops,
  currency,
  onClose,
  onSaved,
}: {
  table: api.ItemTable;
  tripId: string;
  item?: api.Item;
  stops: api.Stop[];
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [why, setWhy] = useState(item?.why_visit ?? "");
  const [stopId, setStopId] = useState(item?.stop_id ?? "");
  const [presentation, setPresentation] = useState(() =>
    getItemPresentation(item?.details, currency),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef({ id: uid(), fingerprint: "" });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const fields = {
        title: title.trim(),
        description,
        stop_id: stopId || null,
        details: saveItemPresentation(item?.details ?? {}, presentation),
        ...(table === "activities" ? { why_visit: why } : {}),
      };
      const fingerprint = JSON.stringify(fields);
      if (request.current.fingerprint !== fingerprint)
        request.current = { id: uid(), fingerprint };
      await api.saveItem(table, tripId, fields, item, request.current.id);
      onSaved();
    } catch (err) {
      setError(explainError(err));
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`${item ? "Επεξεργασία" : "Νέα"} ${ITEM_SINGULAR[table]}`}
      wide
      busy={busy}
      onClose={onClose}
    >
      {error && <Notice>{error}</Notice>}
      <form onSubmit={submit}>
        <label>
          Τίτλος
          <input
            autoFocus
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Τι βρήκες για την παρέα;"
          />
        </label>
        <label>
          Στάση
          <select value={stopId} onChange={(e) => setStopId(e.target.value)}>
            <option value="">Χωρίς συγκεκριμένη στάση</option>
            {stops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Περιγραφή
          <textarea
            rows={4}
            maxLength={20000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Όσα χρειάζεται να ξέρει η παρέα…"
          />
        </label>
        {table === "activities" && (
          <label>
            Γιατί αξίζει
            <textarea
              rows={2}
              maxLength={10000}
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              placeholder="Τι κάνει αυτή την ιδέα ξεχωριστή;"
            />
          </label>
        )}
        <ItemDetailFields
          values={presentation}
          onChange={setPresentation}
          activity={table === "activities"}
        />
        <div className="modal-actions">
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Ακύρωση
          </button>
          <button className="button primary" disabled={busy || !title.trim()}>
            {busy && <LoaderCircle className="spin" size={16} />} Αποθήκευση
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Metadata({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}): ReactNode {
  if (value === null || value === undefined)
    return <span className="muted">—</span>;
  if (depth > 8) return <span>{JSON.stringify(value)}</span>;
  if (Array.isArray(value))
    return (
      <ul className="metadata-list">
        {value.map((entry, i) => (
          <li key={i}>
            <Metadata value={entry} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  if (typeof value === "object")
    return (
      <dl className="metadata">
        {Object.entries(value).map(([key, entry]) => (
          <div key={key}>
            <dt>{key.replaceAll("_", " ")}</dt>
            <dd>
              <Metadata value={entry} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    );
  const text = String(value);
  const url = safeExternalUrl(text);
  if (url)
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {text}
        <ExternalLink size={12} />
      </a>
    );
  return <span>{text}</span>;
}
