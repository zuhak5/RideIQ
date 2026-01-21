import { assertEquals, assert } from "jsr:@std/assert";
import { json, errorJson } from "../_shared/json.ts";

Deno.test("json() returns application/json + CORS headers", async () => {
  const res = json({ ok: true }, 201);
  assertEquals(res.status, 201);
  assertEquals(res.headers.get("content-type"), "application/json");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  const body = await res.json();
  assertEquals(body, { ok: true });
});

Deno.test("errorJson() includes error, code, and extra fields", async () => {
  const res = errorJson("bad", 400, "E_BAD", { hint: "x" });
  assertEquals(res.status, 400);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.error, "bad");
  assertEquals(body.code, "E_BAD");
  assertEquals(body.hint, "x");
  assert(res.headers.get("Access-Control-Allow-Origin") === "*");
});
