import { createClient } from "@supabase/supabase-js";
import { getConfigurationError } from "./publicConfig";
import { captureInvite } from "./invites";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const configurationError = getConfigurationError(url, key);

// Remove invitation material before the Auth client's URL parser initializes.
captureInvite();

export const supabase = configurationError
  ? null
  : createClient(url!, key!, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

export function requireClient() {
  if (!supabase)
    throw new Error(configurationError ?? "Δεν έχει ρυθμιστεί η σύνδεση.");
  return supabase;
}

export function explainError(error: unknown): string {
  const value = error as { message?: string; code?: string; status?: number };
  const message = value?.message ?? String(error);
  if (/failed to fetch|networkerror|network request|load failed/i.test(message))
    return "Δεν μπορέσαμε να συνδεθούμε. Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά.";
  if (
    value?.code === "42P01" ||
    value?.code === "42883" ||
    value?.code?.startsWith("PGRST2")
  )
    return "Η βάση δεδομένων δεν είναι έτοιμη. Για πρώτη εγκατάσταση χρειάζεται το αρχείο supabase/INSTALL_ALL.sql.";
  if (value?.code === "40001")
    return "Έγινε αλλαγή από άλλο μέλος. Ανανέωσε τα στοιχεία και έλεγξε τις αλλαγές πριν αποθηκεύσεις ξανά.";
  if (value?.code === "23505")
    return "Υπάρχει ήδη καταχώριση με αυτά τα στοιχεία. Για ημέρα προγράμματος, διάλεξε διαφορετικό αριθμό.";
  if (value?.code === "23503")
    return "Υπάρχουν συνδεδεμένες καταχωρίσεις. Μετακίνησέ τες ή αφαίρεσέ τες πρώτα και ανανέωσε τα στοιχεία.";
  if (/invalid login credentials/i.test(message))
    return "Το email ή ο κωδικός δεν είναι σωστός.";
  if (/email not confirmed/i.test(message))
    return "Επιβεβαίωσε πρώτα το email σου από τον σύνδεσμο που σου στείλαμε.";
  if (value?.code === "42501" || value?.status === 403)
    return "Δεν έχεις πρόσβαση σε αυτή την ενέργεια ή η συμμετοχή σου στην ομάδα έχει αλλάξει.";
  if (/refresh token|jwt expired/i.test(message))
    return "Η σύνδεσή σου έληξε. Συνδέσου ξανά.";
  if (/rate limit|too many requests/i.test(message))
    return "Έγιναν πολλές προσπάθειες. Περίμενε λίγο και δοκίμασε ξανά.";
  if (/already.*member/i.test(message))
    return "Είσαι ήδη μέλος αυτής της παρέας. Άνοιξε την ομάδα από τις παρέες σου.";
  if (
    /invitation unavailable|invalid.*invit|invit.*(invalid|expired|revoked)/i.test(message)
  )
    return "Η πρόσκληση δεν είναι διαθέσιμη: μπορεί να έχει λήξει, να έχει χρησιμοποιηθεί ή να έχει ανακληθεί. Ζήτησε νέο σύνδεσμο από τον διαχειριστή.";
  return message;
}
