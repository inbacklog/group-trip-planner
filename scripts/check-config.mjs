const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (
  !url ||
  !key ||
  !key.startsWith("sb_publishable_") ||
  /REPLACE|YOUR_PROJECT/i.test(url + key)
) {
  throw new Error(
    "Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY repository variables before publishing.",
  );
}
if (new URL(url).protocol !== "https:")
  throw new Error("Production Supabase URL must use HTTPS.");
console.log(
  "Public frontend configuration is present; this does not validate hosted Auth, schema or RLS.",
);
