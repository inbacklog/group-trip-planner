export function isPublicFrontendKey(key: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  // Local Supabase commonly exposes the legacy JWT anon key.
  try {
    const parts = key.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(
      atob(parts[1].replaceAll("-", "+").replaceAll("_", "/")),
    );
    return payload.role === "anon";
  } catch {
    return false;
  }
}

export function getConfigurationError(
  url?: string,
  key?: string,
): string | null {
  if (!url || !key || /YOUR_PROJECT|REPLACE_ME/.test(url + key)) {
    return "Η εφαρμογή δεν έχει ρυθμιστεί ακόμη. Χρειάζονται το Supabase URL και το publishable key.";
  }
  if (!isPublicFrontendKey(key)) {
    return "Το frontend δέχεται μόνο publishable ή anon key. Secret και service-role keys δεν επιτρέπονται.";
  }
  try {
    const parsed = new URL(url);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (
      (parsed.protocol !== "https:" &&
        !(local && parsed.protocol === "http:")) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/"
    ) {
      return "Το Supabase URL δεν είναι έγκυρο. Χρειάζεται HTTPS ή τοπική διεύθυνση ανάπτυξης.";
    }
    return null;
  } catch {
    return "Το Supabase URL δεν είναι έγκυρο.";
  }
}
