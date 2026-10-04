import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPublicFrontendKey,
  getConfigurationError,
} from "../src/lib/publicConfig.ts";
const key = "sb_publishable_synthetic_test";
const jwt = (role) =>
  [
    "header",
    Buffer.from(JSON.stringify({ role })).toString("base64url"),
    "signature",
  ].join(".");

test("frontend accepts public hosted or local configuration", () => {
  assert.equal(
    getConfigurationError("https://synthetic.supabase.co", key),
    null,
  );
  assert.equal(
    getConfigurationError("http://127.0.0.1:54321", jwt("anon")),
    null,
  );
  assert.equal(getConfigurationError("https://api.example.com", key), null);
});
test("secret, service-role and arbitrary credentials cannot pass the frontend build guard", () => {
  for (const value of [
    "sb_secret_synthetic",
    jwt("service_role"),
    jwt("authenticated"),
    "not-a-key",
  ]) {
    assert.equal(isPublicFrontendKey(value), false);
    assert.ok(getConfigurationError("https://synthetic.supabase.co", value));
  }
});
test("missing, placeholder or unsafe URLs remain a configuration state", () => {
  for (const url of [
    "",
    "https://YOUR_PROJECT_REF.supabase.co",
    "http://external.example",
    "https://user:pass@example.com",
    "javascript:alert(1)",
    "https://example.com/?secret=x",
  ]) {
    assert.ok(getConfigurationError(url, key));
  }
});
