const assert = require("node:assert/strict");
const test = require("node:test");
const handler = require("../api/pilgrim");

const requestId = "9f1fb75a-522b-4e8d-a5a2-f13d9f9e8548";
const record = {
  name: "اسم اصطناعي للاختبار",
  tawkeel: false,
  rami: true,
  slaughter: "not_done"
};
const revision = "a".repeat(64);

function fakeResponse() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = JSON.parse(value); }
  };
}

function inputFor(action) {
  const input = { action };
  if (!["pilgrim.proxyText", "pilgrim.season"].includes(action)) {
    input.lookup = "١٠١٢٣٤٥٦٧٨";
  }
  if (action.startsWith("pilgrim.confirm") || action.startsWith("pilgrim.cancel")) {
    input.expectedVersion = 2;
    input.requestId = requestId;
  }
  if (action === "pilgrim.confirmProxy") input.proxyTextRevision = revision;
  return input;
}

function upstreamFor(action, request) {
  if (action === "pilgrim.lookup" || action.startsWith("pilgrim.confirm") ||
      action.startsWith("pilgrim.cancel")) {
    const data = { record, version: 3 };
    if (action !== "pilgrim.lookup") data.requestId = request.requestId;
    return { ok: true, data };
  }
  if (action === "pilgrim.slaughterStatus") {
    return { ok: true, data: { status: "done" } };
  }
  if (action === "pilgrim.proxyText") {
    return { ok: true, data: { text: "نص التوكيل الاصطناعي", revision } };
  }
  return { ok: true, data: { year: "1448" } };
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

test("forwards only the eight fixed pilgrim actions and returns sanitized shapes", async () => {
  const originalFetch = global.fetch;
  const forwarded = [];
  global.fetch = async (url, options) => {
    const payload = JSON.parse(options.body);
    forwarded.push({ url, options, payload });
    return { ok: true, text: async () => JSON.stringify(upstreamFor(payload.action, payload)) };
  };
  try {
    const actions = [
      "pilgrim.lookup", "pilgrim.proxyText", "pilgrim.confirmProxy",
      "pilgrim.cancelProxy", "pilgrim.confirmRami", "pilgrim.cancelRami",
      "pilgrim.slaughterStatus", "pilgrim.season"
    ];
    for (const [index, action] of actions.entries()) {
      const request = inputFor(action);
      const response = await invoke(request, { ip: `198.51.100.${index + 1}` });
      assert.equal(response.statusCode, 200, action);
      assert.equal(response.body.ok, true, action);
      assert.equal(forwarded[index].payload.action, action);
      assert.equal(forwarded[index].payload.apiToken, process.env.PILGRIM_API_TOKEN);
      assert.equal(response.headers["cache-control"], "no-store, private, max-age=0");
      assert.equal(JSON.stringify(response.body).includes(process.env.PILGRIM_API_TOKEN), false);
      assert.equal(JSON.stringify(response.body).includes("lookup"), false);
    }
    assert.equal(forwarded.length, actions.length);
  } finally {
    global.fetch = originalFetch;
  }
});

test("rejects unknown actions, malformed identifiers, and invalid writes before upstream", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls += 1; throw new Error("should not be called"); };
  try {
    const cases = [
      { action: "search", id: "1012345678" },
      { action: "pilgrim.lookup", lookup: "name@example.com" },
      { action: "pilgrim.confirmRami", lookup: "1012345678", expectedVersion: 0, requestId }
    ];
    for (const request of cases) {
      const response = await invoke(request);
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.ok, false);
      assert.equal(response.body.error.code, "INVALID_REQUEST");
    }
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("rejects methods and non-JSON bodies with no-store headers", async () => {
  const method = await invoke(inputFor("pilgrim.season"), { method: "GET" });
  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.allow, "POST");
  const type = await invoke({}, { contentType: "text/plain" });
  assert.equal(type.statusCode, 415);
  assert.equal(type.headers["cache-control"], "no-store, private, max-age=0");
});

test("does not pass internal upstream messages or personal data to callers", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({
      ok: false,
      error: { code: "UNAVAILABLE", message: "private id 1012345678 and token secret" }
    })
  });
  try {
    const response = await invoke(inputFor("pilgrim.lookup"));
    const serialized = JSON.stringify(response.body);
    assert.equal(response.statusCode, 503);
    assert.equal(serialized.includes("1012345678"), false);
    assert.equal(serialized.includes("secret"), false);
    assert.equal(response.body.error.code, "UNAVAILABLE");
  } finally {
    global.fetch = originalFetch;
  }
});

test("fails closed when the server-side endpoint or token is missing", async () => {
  delete process.env.PILGRIM_API_TOKEN;
  const response = await invoke(inputFor("pilgrim.lookup"));
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.error.code, "UNAVAILABLE");
  process.env.PILGRIM_API_TOKEN = "synthetic-test-secret-with-at-least-32-chars";
  process.env.PILGRIM_APPS_SCRIPT_URL = "https://example.com/anything";
  const invalidUrl = await invoke(inputFor("pilgrim.lookup"));
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
