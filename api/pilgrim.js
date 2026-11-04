const ALLOWED_ACTIONS = new Set([
  "pilgrim.lookup",
  "pilgrim.proxyText",
  "pilgrim.confirmProxy",
  "pilgrim.cancelProxy",
  "pilgrim.confirmRami",
  "pilgrim.cancelRami",
  "pilgrim.slaughterStatus",
  "pilgrim.season"
]);

const WRITE_ACTIONS = new Set([
  "pilgrim.confirmProxy",
  "pilgrim.cancelProxy",
  "pilgrim.confirmRami",
  "pilgrim.cancelRami"
]);

const ERROR_MESSAGES = {
  INVALID_REQUEST: "الطلب غير صالح.",
  FORBIDDEN: "تعذر إتمام الطلب.",
  NOT_FOUND: "لم يتم العثور على سجل.",
  AMBIGUOUS_LOOKUP: "تعذر تحديد سجل واحد بهذا الجوال. استخدم رقم الهوية.",
  VERSION_CONFLICT: "تغيرت الحالة؛ تم إرجاع الحالة الحالية.",
  PROXY_TEXT_UNAVAILABLE: "نص التوكيل غير متاح.",
  PROXY_TEXT_CHANGED: "تغير نص التوكيل؛ أعد قراءته قبل الموافقة.",
  NEEDS_REVIEW: "الحالة تحتاج إلى مراجعة.",
  BLOCKED: "لا يمكن تعديل الحالة بعد تسجيل الذبح.",
  BUSY: "النظام مشغول؛ أعد المحاولة لاحقًا.",
  RATE_LIMITED: "تكررت الطلبات بسرعة. انتظر قليلًا ثم أعد المحاولة.",
  UNAVAILABLE: "الخدمة غير متاحة حاليًا."
};

const rateBuckets = new Map();
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT = 30;
const MAX_RATE_BUCKETS = 500;
const MAX_BODY_BYTES = 4096;
const UPSTREAM_TIMEOUT_MS = 12000;

function isUuid(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeDigits(value) {
  return value.replace(/[٠-٩۰-۹]/g, digit =>
    String("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹".indexOf(digit) % 10)
  );
}

function validateRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      typeof input.action !== "string" || !ALLOWED_ACTIONS.has(input.action)) {
    return { error: "INVALID_REQUEST" };
  }
  const action = input.action;
  if (action === "pilgrim.proxyText" || action === "pilgrim.season") {
    return { value: { action } };
  }

  if (typeof input.lookup !== "string" || input.lookup.length > 32 ||
      !/^[0-9٠-٩۰-۹+\s().-]+$/.test(input.lookup)) {
    return { error: "INVALID_REQUEST" };
  }
  const digits = normalizeDigits(input.lookup).replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 18) {
    return { error: "INVALID_REQUEST" };
  }
  const value = { action, lookup: input.lookup };
  if (WRITE_ACTIONS.has(action)) {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 ||
        !isUuid(input.requestId)) {
      return { error: "INVALID_REQUEST" };
    }
    value.expectedVersion = input.expectedVersion;
    value.requestId = input.requestId;
  }
  if (action === "pilgrim.confirmProxy") {
    if (typeof input.proxyTextRevision !== "string" ||
        !/^[0-9a-f]{64}$/i.test(input.proxyTextRevision)) {
      return { error: "INVALID_REQUEST" };
    }
    value.proxyTextRevision = input.proxyTextRevision;
  }
  return { value };
}

function responseData(action, data, requestId) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (action === "pilgrim.lookup" || WRITE_ACTIONS.has(action)) {
    const record = data.record;
    if (!record || typeof record.name !== "string" ||
        typeof record.tawkeel !== "boolean" || typeof record.rami !== "boolean" ||
        !["done", "not_done", "unavailable"].includes(record.slaughter) ||
        !Number.isSafeInteger(data.version) || data.version < 1) return null;
    const safeRecord = {
      name: record.name,
      tawkeel: record.tawkeel,
      rami: record.rami,
      slaughter: record.slaughter
    };
    if (action === "pilgrim.lookup") return { record: safeRecord, version: data.version };
    if (data.requestId !== requestId) return null;
    return { record: safeRecord, version: data.version, requestId };
  }
  if (action === "pilgrim.slaughterStatus") {
    return ["done", "not_done"].includes(data.status) ? { status: data.status } : null;
  }
  if (action === "pilgrim.proxyText") {
    return typeof data.text === "string" && data.text.trim() &&
      typeof data.revision === "string" && /^[0-9a-f]{64}$/i.test(data.revision)
      ? { text: data.text, revision: data.revision }
      : null;
  }
  if (action === "pilgrim.season") {
    return typeof data.year === "string" && /^(14|15)\d{2}$/.test(data.year)
      ? { year: data.year }
      : null;
  }
  return null;
}

function publicError(code, retryable = false, current) {
  const knownCode = Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code)
    ? code
    : "UNAVAILABLE";
  const error = {
    code: knownCode,
    message: ERROR_MESSAGES[knownCode],
    retryable: retryable === true
  };
  if (knownCode === "VERSION_CONFLICT" && current &&
      current.record && Number.isSafeInteger(current.version) && current.version > 0) {
    const record = current.record;
    if (typeof record.name === "string" &&
        typeof record.tawkeel === "boolean" && typeof record.rami === "boolean" &&
        ["done", "not_done", "unavailable"].includes(record.slaughter)) {
      error.current = {
        record: {
          name: record.name,
          tawkeel: record.tawkeel,
          rami: record.rami,
          slaughter: record.slaughter
        },
        version: current.version
      };
    }
  }
  return { ok: false, error };
}

function setCommonHeaders(res) {
  res.setHeader("Cache-Control", "no-store, private, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function consumeRateLimit(key, now = Date.now()) {
  const current = rateBuckets.get(key);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    for (const [bucketKey, bucket] of rateBuckets) {
      if (now - bucket.startedAt >= RATE_WINDOW_MS) rateBuckets.delete(bucketKey);
    }
    if (!rateBuckets.has(key) && rateBuckets.size >= MAX_RATE_BUCKETS) return false;
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= RATE_LIMIT) return false;
  current.count += 1;
  return true;
}

function upstreamUrl() {
  const configured = process.env.PILGRIM_APPS_SCRIPT_URL;
  if (!configured) return null;
  let url;
  try {
    url = new URL(configured);
  } catch {
    return null;
  }
  return url.protocol === "https:" &&
    url.hostname === "script.google.com" &&
    /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) &&
    !url.search && !url.hash
    ? url.toString()
    : null;
}

function bodySize(req) {
  const contentLength = Number(req.headers && req.headers["content-length"]);
  try {
    const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    const actualSize = Buffer.byteLength(body, "utf8");
    return Number.isFinite(contentLength) && contentLength > 0
      ? Math.max(contentLength, actualSize)
      : actualSize;
  } catch {
    return Infinity;
  }
}

async function handler(req, res) {
  setCommonHeaders(res);
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, publicError("INVALID_REQUEST"));
  }
  if (bodySize(req) > MAX_BODY_BYTES) return send(res, 413, publicError("INVALID_REQUEST"));
  if (!String(req.headers && req.headers["content-type"] || "").toLowerCase().includes("application/json")) {
    return send(res, 415, publicError("INVALID_REQUEST"));
  }

  let input = req.body;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      return send(res, 400, publicError("INVALID_REQUEST"));
    }
  }
  const validation = validateRequest(input);
  if (validation.error) return send(res, 400, publicError(validation.error));

  const ip = String(req.headers && req.headers["x-real-ip"] || "unknown").trim().slice(0, 64);
  if (!consumeRateLimit(ip)) return send(res, 429, publicError("RATE_LIMITED", true));

  const url = upstreamUrl();
  const token = process.env.PILGRIM_API_TOKEN;
  if (!url || !token || token.length < 32) {
    return send(res, 503, publicError("UNAVAILABLE", true));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      body: JSON.stringify({ ...validation.value, apiToken: token })
    });
    const text = await response.text();
    let upstream;
    try {
      upstream = JSON.parse(text);
    } catch {
      return send(res, 502, publicError("UNAVAILABLE", true));
    }
    if (!response.ok || !upstream || typeof upstream !== "object") {
      return send(res, 502, publicError("UNAVAILABLE", true));
    }
    if (upstream.ok !== true) {
      const code = upstream.error && upstream.error.code;
      const status = code === "NOT_FOUND" ? 404
        : code === "FORBIDDEN" ? 403
          : code === "INVALID_REQUEST" ? 400
            : code === "VERSION_CONFLICT" ? 409
              : code === "BUSY" ? 503
                : code === "AMBIGUOUS_LOOKUP" ? 409
                  : code === "BLOCKED" || code === "NEEDS_REVIEW" ||
                    code === "PROXY_TEXT_CHANGED" ? 409
                    : 503;
      return send(res, status, publicError(
        code,
        upstream.error && upstream.error.retryable === true,
        upstream.error && upstream.error.current
      ));
    }
    const data = responseData(validation.value.action, upstream.data, validation.value.requestId);
    if (!data) return send(res, 502, publicError("UNAVAILABLE", true));
    return send(res, 200, { ok: true, data });
  } catch {
    return send(res, 502, publicError("UNAVAILABLE", true));
  } finally {
    clearTimeout(timer);
  }
}

module.exports = handler;
module.exports._test = {
  consumeRateLimit,
  publicError,
  rateBuckets,
  responseData,
  upstreamUrl,
  validateRequest
};
