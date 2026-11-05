(() => {
  const state = {
    lookup: "",
    record: null,
    version: 0,
    recordRef: "",
    seasonYear: "",
    busy: false,
    writing: false
  };
  const icons = {
    done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4.2 4.2L19 6.5"/></svg>',
    pending: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
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

  function showOnly(viewName) {
    document.body.classList.toggle("login-screen", viewName === "login");
    document.body.classList.toggle("pilgrim-screen", viewName === "pilgrim");
    Object.entries(views).forEach(([name, element]) => { element.hidden = name !== viewName; });
    window.scrollTo({ top: 0, behavior: "smooth" });
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
        throw error;
      }
      return payload.data;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function setSeason(year) {
    const label = `موسم حج ${year} هـ`;
    document.querySelectorAll("[data-season-year]").forEach(target => {
      target.textContent = label;
    });
  }

  function setPill(id, isDone, doneText, pendingText) {
    const element = document.getElementById(id);
    element.className = `status-pill${isDone ? "" : " pending"}`;
    element.innerHTML = `${isDone ? icons.done : icons.pending}<span>${isDone ? doneText : pendingText}</span>`;
  }

  function renderRecord() {
    if (!state.record) return;
    document.getElementById("pilgrimName").textContent = state.record.name;
    setPill("tawkeelStatus", state.record.tawkeel, "تم التوكيل", "لم يتم التوكيل بعد");
    setPill("ramiStatus", state.record.rami, "تم الرمي", "لم يتم الرمي بعد");
    renderActions();
    const done = state.record.slaughter === "done";
    const slaughter = document.getElementById("slaughterStatusArea");
    slaughter.replaceChildren();
    const pill = document.createElement("div");
    pill.className = `status-pill${done ? "" : " pending"}`;
    pill.setAttribute("role", "status");
    pill.innerHTML = `${done ? icons.done : icons.pending}<span>${done ? "تم الذبح" : "لم يتم الذبح بعد"}</span>`;
    slaughter.append(pill);
  }

  function actionButton(label, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.disabled = state.writing;
    button.addEventListener("click", handler);
    return button;
  }

  function renderActions() {
    const tawkeel = document.getElementById("tawkeelActions");
    const rami = document.getElementById("ramiActions");
    tawkeel.replaceChildren(state.record.tawkeel
      ? actionButton("تصحيح حالة التوكيل", "danger-button", () => openCorrection("tawkeel"))
      : actionButton("قراءة التوكيل وتأكيده", "primary-button", openProxyDialog));
    rami.replaceChildren(state.record.rami
      ? actionButton("تصحيح حالة الرمي", "danger-button", () => openCorrection("rami"))
      : actionButton("تأكيد إتمام الرمي", "primary-button", openRamiConfirm));
  }

  function toast(message, isError) {
    const element = document.getElementById("pilgrimToast");
    element.textContent = message;
    element.className = `toast${isError ? " error" : ""}`;
    element.hidden = false;
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => { element.hidden = true; }, 5000);
  }

  // لا يُعرض نجاح قبل استجابة الخادم؛ الحالة الجديدة تأتي من الاستجابة فقط.
  async function writeAction(action, extra = {}) {
    if (state.writing || !state.record) return false;
    state.writing = true;
    renderActions();
    try {
      const result = await api(action, {
        lookup: state.lookup,
        expectedVersion: state.version,
        recordRef: state.recordRef,
        seasonYear: state.seasonYear,
        requestId: crypto.randomUUID(),
        ...extra
      });
      state.record = result.record;
      state.version = result.version;
      state.recordRef = result.recordRef;
      state.writing = false;
      renderRecord();
      toast("تم تحديث الحالة.", false);
      return true;
    } catch (error) {
      state.writing = false;
      if (error.code === "VERSION_CONFLICT") {
        await refreshRecord();
        toast(publicMessage(error.code), true);
      } else {
        renderActions();
        toast(publicMessage(error.code), true);
      }
      return false;
    }
  }

  async function refreshRecord() {
    try {
      const result = await api("pilgrim.lookup", { lookup: state.lookup });
      applyLookup(result);
      renderRecord();
    } catch {
      renderActions();
    }
  }

  const proxyDialog = document.getElementById("proxyDialog");
  const proxyConsent = document.getElementById("proxyConsent");
  const proxyConfirm = document.getElementById("proxyConfirmButton");
  const proxyError = document.getElementById("proxyDialogError");
  let proxyRevision = "";

  function syncProxyConfirm() {
    proxyConfirm.disabled = !(proxyRevision && proxyConsent.checked) || state.writing;
  }

  async function openProxyDialog() {
    proxyRevision = "";
    proxyConsent.checked = false;
    document.getElementById("proxyConsentRow").hidden = true;
    proxyError.hidden = true;
    document.getElementById("proxyText").textContent = "جار تحميل نص التوكيل…";
    syncProxyConfirm();
    proxyDialog.showModal();
    try {
      const result = await api("pilgrim.proxyText");
      document.getElementById("proxyText").textContent = result.text;
      proxyRevision = result.revision;
      document.getElementById("proxyConsentRow").hidden = false;
    } catch {
      document.getElementById("proxyText").textContent = "";
      proxyError.textContent = "تعذر تحميل نص التوكيل. أغلق النافذة وحاول مرة أخرى.";
      proxyError.hidden = false;
    }
    syncProxyConfirm();
  }

  proxyConsent.addEventListener("change", syncProxyConfirm);
  document.getElementById("proxyCancelButton").addEventListener("click", () => proxyDialog.close());
  proxyConfirm.addEventListener("click", async () => {
    if (!proxyRevision || !proxyConsent.checked) return;
    proxyConfirm.disabled = true;
    const ok = await writeAction("pilgrim.tawkeel.confirm", {
      consent: true,
      proxyTextRevision: proxyRevision
    });
    if (ok) proxyDialog.close();
    else syncProxyConfirm();
  });

  const confirmDialog = document.getElementById("confirmDialog");
  const confirmAccept = document.getElementById("confirmDialogAccept");
  let confirmAction = "";

  function openConfirm(title, text, acceptLabel, action) {
    document.getElementById("confirmDialogTitle").textContent = title;
    document.getElementById("confirmDialogText").textContent = text;
    confirmAccept.textContent = acceptLabel;
    confirmAction = action;
    confirmAccept.disabled = false;
    confirmDialog.showModal();
  }

  function openRamiConfirm() {
    openConfirm("تأكيد إتمام الرمي", "هل أتممت الرمي وتريد تسجيله؟", "تأكيد إتمام الرمي", "pilgrim.rami.confirm");
  }

  function openCorrection(kind) {
    if (kind === "tawkeel") {
      openConfirm("تصحيح حالة التوكيل", "سيتم إلغاء حالة التوكيل المسجلة. هل تريد المتابعة؟", "تصحيح حالة التوكيل", "pilgrim.tawkeel.correct");
    } else {
      openConfirm("تصحيح حالة الرمي", "سيتم التراجع عن حالة الرمي المسجلة. هل تريد المتابعة؟", "تصحيح حالة الرمي", "pilgrim.rami.correct");
    }
  }

  document.getElementById("confirmDialogCancel").addEventListener("click", () => confirmDialog.close());
  confirmAccept.addEventListener("click", async () => {
    confirmAccept.disabled = true;
    await writeAction(confirmAction);
    confirmDialog.close();
  });

  function applyLookup(result) {
    state.record = result.record;
    state.version = result.version;
    state.recordRef = result.recordRef;
    state.seasonYear = result.seasonYear;
  }

  function publicMessage(code) {
    const messages = {
      VERSION_CONFLICT: "تغيرت حالة السجل، وتم تحديث العرض.",
      PROXY_TEXT_CHANGED: "تغير نص التوكيل. أعد قراءته قبل الموافقة.",
      CONSENT_REQUIRED: "يلزم الموافقة الصريحة على نص التوكيل.",
      NEEDS_REVIEW: "الحالة تحتاج إلى مراجعة من الإدارة.",
      BLOCKED: "لا يمكن تعديل التوكيل أو الرمي بعد تسجيل الذبح.",
      BUSY: "النظام مشغول. أعد المحاولة بعد قليل.",
      AMBIGUOUS_LOOKUP: "يوجد أكثر من سجل مرتبط بهذا الرقم. يرجى البحث باستخدام رقم الهوية.",
      NOT_FOUND: "لم يتم العثور على سجل مطابق.",
      SLAUGHTER_STATUS_UNAVAILABLE: "تعذر التحقق من حالة الذبح؛ لم يتم افتراض أنها غير منفذة.",
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

  async function searchRecord(value) {
    state.lookup = value;
    state.record = null;
    showOnly("loading");
    try {
      const result = await api("pilgrim.lookup", { lookup: value });
      applyLookup(result);
      setSeason(result.seasonYear);
      showOnly("pilgrim");
      renderRecord();
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
    try {
      await searchRecord(value);
    } finally {
      state.busy = false;
      setSearchButtonLoading(false);
    }
  }

  async function loadSeason() {
    try {
      const result = await api("pilgrim.season");
      setSeason(result.year);
    } catch {
      document.querySelectorAll("[data-season-year]").forEach(target => {
        target.textContent = "تعذر تحميل الموسم";
      });
    }
  }

  form.addEventListener("submit", handleSearch);
  document.querySelectorAll("[data-action='back-to-search']").forEach(button => {
    button.addEventListener("click", () => {
      state.lookup = "";
      state.record = null;
      searchInput.value = "";
      showOnly("login");
      searchInput.focus({ preventScroll: true });
    });
  });
  document.querySelector("[data-action='retry-search']").addEventListener("click", () => {
    if (!state.lookup || state.busy) return;
    state.busy = true;
    setSearchButtonLoading(true);
    searchRecord(state.lookup).finally(() => {
      state.busy = false;
      setSearchButtonLoading(false);
    });
  });
  showOnly("login");
  loadSeason();
})();
