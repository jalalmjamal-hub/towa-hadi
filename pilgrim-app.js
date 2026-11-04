(() => {
  const state = {
    lookup: "",
    record: null,
    busy: false
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
    document.getElementById("tawkeelActions").textContent = "للعرض فقط في هذه المرحلة.";
    document.getElementById("ramiActions").textContent = "للعرض فقط في هذه المرحلة.";
    const done = state.record.slaughter === "done";
    const slaughter = document.getElementById("slaughterStatusArea");
    slaughter.replaceChildren();
    const pill = document.createElement("div");
    pill.className = `status-pill${done ? "" : " pending"}`;
    pill.setAttribute("role", "status");
    pill.innerHTML = `${done ? icons.done : icons.pending}<span>${done ? "تم الذبح" : "لم يتم الذبح بعد"}</span>`;
    slaughter.append(pill);
  }

  function publicMessage(code) {
    const messages = {
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
      state.record = result.record;
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
