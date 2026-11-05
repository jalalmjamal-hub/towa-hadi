const ALLOWED_ACTIONS = new Set([
  "pilgrim.lookup",
  "pilgrim.season",
  "pilgrim.proxyText",
  "pilgrim.tawkeel.confirm",
  "pilgrim.tawkeel.correct",
  "pilgrim.rami.confirm",
  "pilgrim.rami.correct"
]);
const WRITE_ACTIONS = new Set([
  "pilgrim.tawkeel.confirm",
  "pilgrim.tawkeel.correct",
  "pilgrim.rami.confirm",
  "pilgrim.rami.correct"
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX64_PATTERN = /^[0-9a-f]{64}$/;
const SEASON_PATTERN = /^(14|15)\d{2}$/;
const MAX_PROXY_TEXT_LENGTH = 20000;

const ERROR_MESSAGES = {
  INVALID_REQUEST: "الطلب غير صالح.",
  FORBIDDEN: "تعذر إتمام الطلب.",
  NOT_FOUND: "لم يتم العثور على سجل.",
  AMBIGUOUS_LOOKUP: "يوجد أكثر من سجل مرتبط بهذا الرقم. يرجى البحث باستخدام رقم الهوية.",
  SLAUGHTER_STATUS_UNAVAILABLE: "تعذر التحقق من حالة الذبح؛ لم يتم افتراض أنها غير منفذة.",
  VERSION_CONFLICT: "تغيرت حالة السجل. أعد البحث ثم حاول مرة أخرى.",
  PROXY_TEXT_UNAVAILABLE: "نص التوكيل غير متاح حاليًا.",
  PROXY_TEXT_CHANGED: "تغير نص التوكيل. أعد قراءته قبل الموافقة.",
  CONSENT_REQUIRED: "يلزم الموافقة الصريحة على نص التوكيل.",
  NEEDS_REVIEW: "الحالة تحتاج إلى مراجعة من الإدارة.",
  BLOCKED: "لا يمكن تعديل التوكيل أو الرمي بعد تسجيل الذبح.",
  BUSY: "النظام مشغول. أعد المحاولة بعد قليل.",
  RATE_LIMITED: "تكررت الطلبات بسرعة. انتظر قليلًا ثم أعد المحاولة.",
  UNAVAILABLE: "الخدمة غير متاحة حاليًا."
};

const rateBuckets = new Map();
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT = 30;
const MAX_RATE_BUCKETS = 500;
const MAX_BODY_BYTES = 4096;
const UPSTREAM_TIMEOUT_MS = 12000;

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
  if (action === "pilgrim.season" || action === "pilgrim.proxyText") {
    if (Object.keys(input).some(key => key !== "action")) {
      return { error: "INVALID_REQUEST" };
    }
    return { value: { action } };
  }

  const isWrite = WRITE_ACTIONS.has(action);
  const allowed = new Set(["action", "lookup"]);
  if (isWrite) {
    ["expectedVersion", "requestId", "recordRef", "seasonYear"].forEach(key => allowed.add(key));
    if (action === "pilgrim.tawkeel.confirm") {
      allowed.add("consent");
      allowed.add("proxyTextRevision");
    }
  }
  if (Object.keys(input).some(key => !allowed.has(key))) {
    return { error: "INVALID_REQUEST" };
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
  if (!isWrite) return { value };

  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 ||
      typeof input.requestId !== "string" || !UUID_PATTERN.test(input.requestId) ||
      typeof input.recordRef !== "string" || !HEX64_PATTERN.test(input.recordRef) ||
      typeof input.seasonYear !== "string" || !SEASON_PATTERN.test(input.seasonYear)) {
    return { error: "INVALID_REQUEST" };
  }
  Object.assign(value, {
    expectedVersion: input.expectedVersion,
    requestId: input.requestId,
    recordRef: input.recordRef,
    seasonYear: input.seasonYear
  });
  if (action === "pilgrim.tawkeel.confirm") {
    if (input.consent !== true) return { error: "CONSENT_REQUIRED" };
    if (typeof input.proxyTextRevision !== "string" ||
        !HEX64_PATTERN.test(input.proxyTextRevision)) {
      return { error: "INVALID_REQUEST" };
    }
    value.consent = true;
    value.proxyTextRevision = input.proxyTextRevision;
  }
  return { value };
}

function responseData(action, data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (action === "pilgrim.lookup" || WRITE_ACTIONS.has(action)) {
    const record = data.record;
    if (!record || typeof record.name !== "string" ||
        typeof record.tawkeel !== "boolean" || typeof record.rami !== "boolean" ||
        !["done", "not_done"].includes(record.slaughter) ||
        typeof data.seasonYear !== "string" ||
        !SEASON_PATTERN.test(data.seasonYear) ||
        !Number.isSafeInteger(data.version) || data.version < 1 ||
        typeof data.recordRef !== "string" || !HEX64_PATTERN.test(data.recordRef)) return null;
    const result = {
      record: {
        name: record.name,
        tawkeel: record.tawkeel,
        rami: record.rami,
        slaughter: record.slaughter
      },
      seasonYear: data.seasonYear,
      version: data.version,
      recordRef: data.recordRef
    };
    if (WRITE_ACTIONS.has(action)) {
      if (typeof data.changed !== "boolean") return null;
      result.changed = data.changed;
    }
    return result;
  }
  if (action === "pilgrim.proxyText") {
    return typeof data.text === "string" && data.text.length > 0 &&
      data.text.length <= MAX_PROXY_TEXT_LENGTH &&
      typeof data.revision === "string" && HEX64_PATTERN.test(data.revision)
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

function publicError(code, retryable = false) {
  const knownCode = Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code)
    ? code
    : "UNAVAILABLE";
  const error = {
    code: knownCode,
    message: ERROR_MESSAGES[knownCode],
    retryable: retryable === true
  };
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

function diagnosticContentType(headers) {
  const contentType = headers && headers.get
    ? String(headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase()
    : "";
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(contentType)
    ? contentType
    : "unknown";
}

function logUpstreamDiagnostic(code, details) {
  const entry = {
    event: "pilgrim_upstream",
    code,
    action: ALLOWED_ACTIONS.has(details.action) ? details.action : "unknown",
    stage: details.stage
  };
  if (Number.isInteger(details.status)) entry.status = details.status;
  if (details.contentType) entry.contentType = details.contentType;
  if (typeof details.redirected === "boolean") entry.redirected = details.redirected;
  if (["AbortError", "TypeError", "Error"].includes(details.errorType)) {
    entry.errorType = details.errorType;
  }
  if (Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, details.errorCode)) {
    entry.errorCode = details.errorCode;
  }
  console.info(JSON.stringify(entry));
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
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
        body: JSON.stringify({ ...validation.value, apiToken: token })
      });
    } catch (error) {
      logUpstreamDiagnostic("UPSTREAM_FETCH_FAILED", {
        action: validation.value.action,
        stage: "fetch",
        errorType: error && error.name
      });
      return send(res, 502, publicError("UNAVAILABLE", true));
    }

    const upstreamDetails = {
      action: validation.value.action,
      stage: "response",
      status: response.status,
      contentType: diagnosticContentType(response.headers),
      redirected: response.redirected === true
    };
    let text;
    try {
      text = await response.text();
    } catch {
      logUpstreamDiagnostic("UPSTREAM_INVALID_RESPONSE", {
        ...upstreamDetails,
        stage: "body_read"
      });
      return send(res, 502, publicError("UNAVAILABLE", true));
    }

    let upstream;
    try {
      upstream = JSON.parse(text);
    } catch {
      logUpstreamDiagnostic("UPSTREAM_NON_JSON", {
        ...upstreamDetails,
        stage: "json_parse"
      });
      return send(res, 502, publicError("UNAVAILABLE", true));
    }
    if (!response.ok) {
      logUpstreamDiagnostic("UPSTREAM_HTTP_ERROR", {
        ...upstreamDetails,
        stage: "http_status"
      });
      return send(res, 502, publicError("UNAVAILABLE", true));
    }
    if (!upstream || typeof upstream !== "object" || Array.isArray(upstream)) {
      logUpstreamDiagnostic("UPSTREAM_INVALID_RESPONSE", {
        ...upstreamDetails,
        stage: "json_shape"
      });
      return send(res, 502, publicError("UNAVAILABLE", true));
    }
    if (upstream.ok !== true) {
      const code = upstream.error && upstream.error.code;
      const safeCode = Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code)
        ? code
        : "UNAVAILABLE";
      logUpstreamDiagnostic("UPSTREAM_APP_ERROR", {
        ...upstreamDetails,
        stage: "application_result",
        errorCode: safeCode
      });
      const status = code === "NOT_FOUND" ? 404
        : code === "FORBIDDEN" ? 403
          : code === "INVALID_REQUEST" ? 400
            : ["AMBIGUOUS_LOOKUP", "VERSION_CONFLICT", "PROXY_TEXT_CHANGED",
              "NEEDS_REVIEW", "BLOCKED"].includes(code) ? 409
              : code === "CONSENT_REQUIRED" ? 400
                : 503;
      return send(res, status, publicError(code, upstream.error && upstream.error.retryable === true));
    }
    const data = responseData(validation.value.action, upstream.data);
    if (!data) {
      logUpstreamDiagnostic("UPSTREAM_INVALID_RESPONSE", {
        ...upstreamDetails,
        stage: "payload_validation"
      });
      return send(res, 502, publicError("UNAVAILABLE", true));
    }
    logUpstreamDiagnostic("UPSTREAM_OK", {
      ...upstreamDetails,
      stage: "complete"
    });
    return send(res, 200, { ok: true, data });
  } catch (error) {
    logUpstreamDiagnostic("UPSTREAM_INVALID_RESPONSE", {
      action: validation.value.action,
      stage: "processing",
      errorType: error && error.name
    });
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
