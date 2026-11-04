(() => {
  const state = {
    lookup: "",
    record: null,
    version: 0,
    slaughter: "unavailable",
    proxyTextRevision: "",
    correctionKey: null,
    busy: false,
    toastTimer: null
  };
  const icons = {
    done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4.2 4.2L19 6.5"/></svg>',
    pending: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2.5 12s3.2-6 9.5-6 9.5 6 9.5 6-3.2 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.7"/></svg>',
    correct: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 1-2-5"/></svg>'
  };
  const views = {
    login: document.getElementById("loginView"),
    loading: document.getElementById("loadingView"),
    notFound: document.getElementById("notFoundView"),
    networkError: document.getElementById("networkErrorView"),
    pilgrim: document.getElementById("pilgrimView")
  };
  const form = document.getElementById("searchForm");
  const searchInput = document.getElementById("searchValue");
  const searchButton = document.getElementById("searchButton");
  const searchMessage = document.getElementById("searchMessage");
  const toast = document.getElementById("toast");
  const tawkeelDialog = document.getElementById("tawkeelDialog");
  const correctionDialog = document.getElementById("correctionDialog");
  const acceptTawkeelButton = document.getElementById("acceptTawkeelButton");

  function showOnly(viewName) {
    document.body.classList.toggle("login-screen", viewName === "login");
    document.body.classList.toggle("pilgrim-screen", viewName === "pilgrim");
    Object.entries(views).forEach(([name, element]) => { element.hidden = name !== viewName; });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function requestId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  async function api(action, values = {}) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch("/api/pilgrim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "same-origin",
        body: JSON.stringify({ action, ...values }),
        signal: controller.signal
      });
      const payload = await response.json();
      if (!response.ok || !payload || payload.ok !== true) {
        const error = new Error(payload?.error?.message || "تعذر إكمال الطلب.");
        error.code = payload?.error?.code || "UNAVAILABLE";
        error.current = payload?.error?.current || null;
        throw error;
      }
      return payload.data;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function showToast(message, isError = false) {
    window.clearTimeout(state.toastTimer);
    toast.className = `toast${isError ? " error" : ""}`;
    toast.replaceChildren();
    const icon = document.createElement("span");
    icon.innerHTML = isError
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></svg>'
      : icons.done;
    const text = document.createElement("span");
    text.textContent = message;
    toast.append(icon, text);
    toast.hidden = false;
    state.toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3500);
  }

  function setPill(id, isDone, doneText, pendingText) {
    const element = document.getElementById(id);
    element.className = `status-pill${isDone ? "" : " pending"}`;
    element.innerHTML = `${isDone ? icons.done : icons.pending}<span>${isDone ? doneText : pendingText}</span>`;
  }

  function actionButton(label, handler, icon, className = "secondary-button") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.disabled = state.busy;
    button.innerHTML = `${icon}<span>${label}</span>`;
    button.addEventListener("click", handler);
    return button;
  }

  function renderSlaughter() {
    const area = document.getElementById("slaughterStatusArea");
    area.replaceChildren();
    if (state.slaughter !== "done" && state.slaughter !== "not_done") {
      const error = document.createElement("div");
      error.className = "status-error-card";
      error.setAttribute("role", "alert");
      const heading = document.createElement("strong");
      heading.textContent = "تعذر تحميل حالة الذبح";
      const description = document.createElement("p");
      description.textContent = "لم نتمكن من تأكيد الحالة الآن. لا يمكن اعتبار ذلك «لم يتم الذبح بعد».";
      const retry = document.createElement("button");
      retry.className = "secondary-button";
      retry.type = "button";
      retry.textContent = "إعادة المحاولة";
      retry.disabled = state.busy;
      retry.addEventListener("click", loadSlaughter);
      error.append(heading, description, retry);
      area.append(error);
      return;
    }
    const done = state.slaughter === "done";
    const pill = document.createElement("div");
    pill.className = `status-pill${done ? "" : " pending"}`;
    pill.setAttribute("role", "status");
    pill.innerHTML = `${done ? icons.done : icons.pending}<span>${done ? "تم الذبح" : "لم يتم الذبح بعد"}</span>`;
    area.append(pill);
  }

  function renderRecord() {
    if (!state.record) return;
    document.getElementById("pilgrimName").textContent = state.record.name;
    setPill("tawkeelStatus", state.record.tawkeel, "تم التوكيل", "لم يتم التوكيل بعد");
    setPill("ramiStatus", state.record.rami, "تم الرمي", "لم يتم الرمي بعد");
    const tawkeelActions = document.getElementById("tawkeelActions");
    tawkeelActions.replaceChildren();
    tawkeelActions.append(actionButton("عرض نص التوكيل", loadTawkeelText, icons.eye));
    if (state.record.tawkeel) {
      tawkeelActions.append(actionButton("تصحيح الحالة", () => openCorrection("tawkeel"), icons.correct, "danger-button"));
    }
    const ramiActions = document.getElementById("ramiActions");
    ramiActions.replaceChildren();
    ramiActions.append(state.record.rami
      ? actionButton("تصحيح الحالة", () => openCorrection("rami"), icons.correct, "danger-button")
      : actionButton("تأكيد الرمي", () => updateStatus("pilgrim.confirmRami"), icons.done, "primary-button"));
    acceptTawkeelButton.hidden = state.record.tawkeel;
    acceptTawkeelButton.disabled = state.busy || !state.proxyTextRevision;
    document.getElementById("confirmCorrectionButton").disabled = state.busy;
    renderSlaughter();
  }

  function publicMessage(code) {
    const messages = {
      AMBIGUOUS_LOOKUP: "تعذر تحديد سجل واحد بهذا الجوال. جرّب البحث برقم الهوية.",
      NOT_FOUND: "لم يتم العثور على سجل. تحقق من الرقم وحاول مرة أخرى.",
      VERSION_CONFLICT: "تغيرت الحالة منذ آخر تحديث. راجع الحالة الحالية وحاول مجددًا.",
      PROXY_TEXT_CHANGED: "تغير نص التوكيل. أغلق النافذة وافتح النص المحدّث قبل الموافقة.",
      PROXY_TEXT_UNAVAILABLE: "نص التوكيل غير متاح حاليًا.",
      NEEDS_REVIEW: "تعذر تنفيذ الإجراء بسبب حالة تشغيلية تحتاج إلى مراجعة.",
      BLOCKED: "لا يمكن تعديل الحالة بعد تسجيل الذبح.",
      BUSY: "النظام مشغول. انتظر قليلًا ثم أعد المحاولة.",
      INVALID_REQUEST: "تعذر التحقق من الرقم المدخل.",
      RATE_LIMITED: "تكررت الطلبات بسرعة. انتظر قليلًا ثم أعد المحاولة."
    };
    return messages[code] || "تعذر الاتصال بالخدمة. حاول مرة أخرى لاحقًا.";
  }

  function setSearchButtonLoading(loading) {
    searchButton.disabled = loading;
    searchButton.innerHTML = loading
      ? '<span class="spinner" aria-hidden="true"></span><span>جار البحث…</span>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg><span>بحث</span>';
  }

  async function loadSlaughter() {
    if (!state.lookup) return;
    try {
      const result = await api("pilgrim.slaughterStatus", { lookup: state.lookup });
      state.slaughter = result.status;
    } catch {
      state.slaughter = "unavailable";
    }
    renderSlaughter();
  }

  async function searchRecord(value) {
    state.lookup = value;
    state.record = null;
    showOnly("loading");
    try {
      const result = await api("pilgrim.lookup", { lookup: value });
      state.record = result.record;
      state.version = result.version;
      state.slaughter = result.record.slaughter;
      state.proxyTextRevision = "";
      showOnly("pilgrim");
      renderRecord();
      if (state.slaughter !== "done" && state.slaughter !== "not_done") await loadSlaughter();
    } catch (error) {
      if (error.code === "NOT_FOUND") showOnly("notFound");
      else {
        document.querySelector("#networkErrorView p").textContent = publicMessage(error.code);
        showOnly("networkError");
      }
    }
  }

  async function handleSearch(event) {
    event.preventDefault();
    if (state.busy) return;
    const value = searchInput.value.trim();
    searchMessage.hidden = true;
    if (!value) {
      searchMessage.textContent = "أدخل رقم الهوية أو الجوال.";
      searchMessage.hidden = false;
      searchInput.focus();
      return;
    }
    state.busy = true;
    setSearchButtonLoading(true);
    await searchRecord(value);
    state.busy = false;
    setSearchButtonLoading(false);
    if (state.record) renderRecord();
  }

  async function loadTawkeelText() {
    if (state.busy) return;
    const content = document.getElementById("proxyTextContent");
    content.textContent = "جارٍ تحميل نص التوكيل…";
    state.proxyTextRevision = "";
    acceptTawkeelButton.disabled = true;
    tawkeelDialog.showModal();
    state.busy = true;
    try {
      const result = await api("pilgrim.proxyText");
      if (!result.text || !result.text.trim()) throw Object.assign(new Error(""), { code: "PROXY_TEXT_UNAVAILABLE" });
      content.textContent = result.text;
      state.proxyTextRevision = result.revision;
    } catch (error) {
      content.textContent = publicMessage(error.code);
    } finally {
      state.busy = false;
      acceptTawkeelButton.disabled = !state.proxyTextRevision || state.record?.tawkeel;
      renderRecord();
    }
  }

  async function updateStatus(action) {
    if (state.busy || !state.record) return;
    state.busy = true;
    renderRecord();
    const values = {
      lookup: state.lookup,
      expectedVersion: state.version,
      requestId: requestId()
    };
    if (action === "pilgrim.confirmProxy") values.proxyTextRevision = state.proxyTextRevision;
    try {
      const result = await api(action, values);
      state.record = result.record;
      state.version = result.version;
      state.slaughter = result.record.slaughter;
      tawkeelDialog.close();
      correctionDialog.close();
      showToast("تم تحديث الحالة بعد تأكيد الخادم.");
    } catch (error) {
      if (error.current) {
        state.record = error.current.record;
        state.version = error.current.version;
        state.slaughter = error.current.record.slaughter;
      } else if (error.code !== "PROXY_TEXT_CHANGED" && error.code !== "PROXY_TEXT_UNAVAILABLE") {
        await refreshRecord();
      }
      showToast(publicMessage(error.code), true);
    } finally {
      state.busy = false;
      renderRecord();
    }
  }

  async function refreshRecord() {
    if (!state.lookup) return;
    try {
      const result = await api("pilgrim.lookup", { lookup: state.lookup });
      state.record = result.record;
      state.version = result.version;
      state.slaughter = result.record.slaughter;
      if (state.slaughter !== "done" && state.slaughter !== "not_done") await loadSlaughter();
    } catch {
      state.slaughter = "unavailable";
    }
  }

  function openCorrection(key) {
    state.correctionKey = key;
    const label = key === "tawkeel" ? "التوكيل" : "الرمي";
    const completed = key === "tawkeel" ? "تم التوكيل" : "تم الرمي";
    const reverted = key === "tawkeel" ? "لم يتم التوكيل بعد" : "لم يتم الرمي بعد";
    const copy = document.getElementById("correctionCopy");
    copy.replaceChildren(document.createTextNode("سيؤدي تصحيح حالة "));
    const strong = document.createElement("strong");
    strong.textContent = label;
    copy.append(strong, document.createTextNode(` إلى إلغاء التأكيد «${completed}»، وستعود الحالة إلى «${reverted}».`));
    correctionDialog.showModal();
  }

  async function confirmCorrection() {
    if (!state.correctionKey) return;
    const action = state.correctionKey === "tawkeel" ? "pilgrim.cancelProxy" : "pilgrim.cancelRami";
    state.correctionKey = null;
    await updateStatus(action);
  }

  async function loadSeason() {
    const targets = document.querySelectorAll("[data-season-year]");
    try {
      const result = await api("pilgrim.season");
      const label = `موسم حج ${result.year} هـ`;
      targets.forEach(target => { target.textContent = label; });
    } catch {
      targets.forEach(target => { target.textContent = "تعذر تحميل الموسم"; });
    }
  }

  form.addEventListener("submit", handleSearch);
  acceptTawkeelButton.addEventListener("click", () => updateStatus("pilgrim.confirmProxy"));
  document.getElementById("confirmCorrectionButton").addEventListener("click", confirmCorrection);
  document.querySelectorAll("[data-close-dialog]").forEach(button => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });
  [tawkeelDialog, correctionDialog].forEach(dialog => {
    dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  });
  document.querySelectorAll("[data-action='back-to-search']").forEach(button => {
    button.addEventListener("click", () => {
      state.lookup = "";
      state.record = null;
      state.version = 0;
      state.slaughter = "unavailable";
      state.proxyTextRevision = "";
      searchInput.value = "";
      showOnly("login");
      searchInput.focus({ preventScroll: true });
    });
  });
  document.querySelector("[data-action='retry-search']").addEventListener("click", () => {
    if (!state.lookup || state.busy) return;
    state.busy = true;
    searchRecord(state.lookup).finally(() => {
      state.busy = false;
      if (state.record) renderRecord();
    });
  });
  showOnly("login");
  loadSeason();
})();
