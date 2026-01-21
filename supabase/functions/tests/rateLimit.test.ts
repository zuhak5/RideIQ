import { assertEquals } from "jsr:@std/assert";
import { getClientIp } from "../_shared/rateLimit.ts";

Deno.test("getClientIp() parses x-forwarded-for first hop", () => {
  const req = new Request("https://example.com", {
    headers: {
      "x-forwarded-for": "203.0.113.10, 70.41.3.18, 150.172.238.178",
    },
  });
  assertEquals(getClientIp(req), "203.0.113.10");
});

Deno.test("getClientIp() returns null when header missing", () => {
  const req = new Request("https://example.com");
  assertEquals(getClientIp(req), null);
});
