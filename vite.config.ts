import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { isPublicFrontendKey } from "./src/lib/publicConfig";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (key && !isPublicFrontendKey(key)) {
    throw new Error(
      "Only a publishable/anon key may enter the frontend. Remove secret/service-role credentials before building.",
    );
  }
  return {
    plugins: [react()],
    base: env.VITE_BASE_PATH || "/",
    build: {
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            supabase: ['@supabase/supabase-js'],
            react: ['react', 'react-dom'],
          },
        },
      },
    },
    server: { host: "127.0.0.1", port: 5173 },
  };
});
