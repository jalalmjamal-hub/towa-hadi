const assert = require("node:assert/strict");
const test = require("node:test");
const handler = require("../api/pilgrim");

const record = {
  name: "حاج اصطناعي للاختبار",
  tawkeel: true,
  rami: false,
  slaughter: "not_done"
};

function fakeResponse() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = JSON.parse(value); }
  };
}

async function invoke(input, options = {}) {
  const response = fakeResponse();
  const request = {
    method: options.method || "POST",
    headers: {
      "content-type": options.contentType || "application/json",
      "x-real-ip": options.ip || `192.0.2.${Math.floor(Math.random() * 200) + 1}`,
      ...(options.headers || {})
    },
    body: options.raw === undefined ? input : options.raw
  };
  await handler(request, response);
  return response;
}

test.beforeEach(() => {
  handler._test.rateBuckets.clear();
  process.env.PILGRIM_APPS_SCRIPT_URL = "https://script.google.com/macros/s/test-deployment/exec";
  process.env.PILGRIM_API_TOKEN = "synthetic-test-secret-with-at-least-32-chars";
});

test("forwards only lookup and season without caching personal data", async () => {
  const originalFetch = global.fetch;
  const forwarded = [];
  global.fetch = async (url, options) => {
    const payload = JSON.parse(options.body);
    forwarded.push({ url, options, payload });
    const data = payload.action === "pilgrim.lookup"
      ? { seasonYear: "1448", record, version: 1, recordRef: "a".repeat(64) }
      : { year: "1448" };
    return { ok: true, text: async () => JSON.stringify({ ok: true, data }) };
  };
  try {
    const lookup = await invoke({ action: "pilgrim.lookup", lookup: "0012345678" });
    assert.equal(lookup.statusCode, 200);
    assert.deepEqual(lookup.body.data, {
      seasonYear: "1448",
      record,
      version: 1,
      recordRef: "a".repeat(64)
    });
    assert.equal(forwarded[0].payload.lookup, "0012345678");
    assert.equal(forwarded[0].payload.apiToken, process.env.PILGRIM_API_TOKEN);
    assert.equal(forwarded[0].options.cache, "no-store");
    assert.equal(lookup.headers["cache-control"], "no-store, private, max-age=0");
    assert.equal(JSON.stringify(lookup.body).includes("0012345678"), false);
    assert.equal(JSON.stringify(lookup.body).includes(process.env.PILGRIM_API_TOKEN), false);

    const season = await invoke({ action: "pilgrim.season" });
    assert.equal(season.statusCode, 200);
    assert.deepEqual(season.body.data, { year: "1448" });
    assert.equal(forwarded.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("rejects unknown, malformed, injected-field, and consent-less requests before upstream", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls += 1; throw new Error("should not be called"); };
  const write = {
    lookup: "0012345678", expectedVersion: 1, recordRef: "a".repeat(64),
    seasonYear: "1448", requestId: "123e4567-e89b-42d3-a456-426614174000"
  };
  try {
    for (const input of [
      { action: "pilgrim.confirmRami", lookup: "0012345678" },
      { action: "pilgrim.cancelProxy", lookup: "0012345678" },
      { action: "pilgrim.proxyText", lookup: "0012345678" },
      { action: "pilgrim.slaughterStatus", lookup: "0012345678" },
      { action: "pilgrim.slaughter.confirm", ...write },
      { action: "pilgrim.rami.confirm", ...write, column: "G" },
      { action: "pilgrim.rami.confirm", ...write, row: 2 },
      { action: "pilgrim.rami.confirm", ...write, consent: true },
      { action: "pilgrim.rami.confirm", ...write, expectedVersion: 0 },
      { action: "pilgrim.rami.confirm", ...write, requestId: "x" },
      { action: "pilgrim.rami.confirm", lookup: "0012345678" },
      { action: "search", id: "0012345678" },
      { action: "pilgrim.lookup", lookup: "name@example.com" },
      { action: "pilgrim.lookup", lookup: "0012345678", id: "another-value" }
    ]) {
      const response = await invoke(input);
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.ok, false);
      assert.equal(response.body.error.code, "INVALID_REQUEST");
    }
    const noConsent = await invoke({
      action: "pilgrim.tawkeel.confirm", ...write, proxyTextRevision: "b".repeat(64)
    });
    assert.equal(noConsent.statusCode, 400);
    assert.equal(noConsent.body.error.code, "CONSENT_REQUIRED");
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("rejects methods and non-JSON bodies with no-store headers", async () => {
  const method = await invoke({ action: "pilgrim.season" }, { method: "GET" });
  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.allow, "POST");
  const type = await invoke({}, { contentType: "text/plain" });
  assert.equal(type.statusCode, 415);
  assert.equal(type.headers["cache-control"], "no-store, private, max-age=0");
});

test("sanitizes personal data and internal details from upstream errors", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({
      ok: false,
      error: {
        code: "SLAUGHTER_STATUS_UNAVAILABLE",
        message: "private id 0012345678 and token secret"
      }
    })
  });
  try {
    const response = await invoke({ action: "pilgrim.lookup", lookup: "0012345678" });
    const serialized = JSON.stringify(response.body);
    assert.equal(response.statusCode, 503);
    assert.equal(serialized.includes("0012345678"), false);
    assert.equal(serialized.includes("secret"), false);
    assert.equal(response.body.error.code, "SLAUGHTER_STATUS_UNAVAILABLE");
  } finally {
    global.fetch = originalFetch;
  }
});

test("logs sanitized diagnostics for successful, non-JSON, and failed upstream calls", async () => {
  const originalFetch = global.fetch;
  const originalInfo = console.info;
  const entries = [];
  console.info = message => entries.push(JSON.parse(message));
  try {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      redirected: true,
      headers: { get: () => "application/json; charset=utf-8" },
      text: async () => JSON.stringify({ ok: true, data: { year: "1448" } })
    });
    const success = await invoke({ action: "pilgrim.season" });
    assert.equal(success.statusCode, 200);
    assert.deepEqual(entries[0], {
      event: "pilgrim_upstream",
      code: "UPSTREAM_OK",
      action: "pilgrim.season",
      stage: "complete",
      status: 200,
      contentType: "application/json",
      redirected: true
    });

    global.fetch = async () => ({
      ok: true,
      status: 200,
      redirected: false,
      headers: { get: () => "text/html; charset=utf-8" },
      text: async () => `<html>token=${process.env.PILGRIM_API_TOKEN}; id=0012345678</html>`
    });
    const nonJson = await invoke({ action: "pilgrim.season" });
    assert.equal(nonJson.statusCode, 502);
    assert.equal(entries[1].code, "UPSTREAM_NON_JSON");

    global.fetch = async () => {
      throw new Error(`token=${process.env.PILGRIM_API_TOKEN}; id=0012345678`);
    };
    const failed = await invoke({ action: "pilgrim.season" });
    assert.equal(failed.statusCode, 502);
    assert.equal(entries[2].code, "UPSTREAM_FETCH_FAILED");
    const serializedLogs = JSON.stringify(entries);
    assert.equal(serializedLogs.includes(process.env.PILGRIM_API_TOKEN), false);
    assert.equal(serializedLogs.includes("0012345678"), false);
  } finally {
    global.fetch = originalFetch;
    console.info = originalInfo;
  }
});

test("fails closed when the server-side endpoint or token is missing", async () => {
  delete process.env.PILGRIM_API_TOKEN;
  const response = await invoke({ action: "pilgrim.season" });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.error.code, "UNAVAILABLE");
  process.env.PILGRIM_API_TOKEN = "synthetic-test-secret-with-at-least-32-chars";
  process.env.PILGRIM_APPS_SCRIPT_URL = "https://example.com/anything";
  const invalidUrl = await invoke({ action: "pilgrim.season" });
  assert.equal(invalidUrl.statusCode, 503);
});

test("rate limit rejects requests beyond the per-instance allowance", () => {
  const now = 100000;
  for (let count = 0; count < 30; count += 1) {
    assert.equal(handler._test.consumeRateLimit("synthetic-ip", now), true);
  }
  assert.equal(handler._test.consumeRateLimit("synthetic-ip", now), false);
  assert.equal(handler._test.consumeRateLimit("synthetic-ip", now + 5 * 60 * 1000), true);
});
