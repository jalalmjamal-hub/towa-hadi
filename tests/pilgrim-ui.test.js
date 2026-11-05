const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const source = fs.readFileSync(path.join(__dirname, "..", "pilgrim-app.js"), "utf8");
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function createElement(tag = "div") {
  const listeners = {};
  return {
    tag,
    hidden: false,
    disabled: false,
    checked: false,
    value: "",
    className: "",
    textContent: "",
    innerHTML: "",
    children: [],
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {},
    focus() {},
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    addEventListener(type, handler) { (listeners[type] ||= []).push(handler); },
    showModal() { this.open = true; },
    close() { this.open = false; },
    async fire(type, event = { preventDefault() {} }) {
      await Promise.all((listeners[type] || []).map(handler => handler(event)));
      await settle();
    }
  };
}

function createApp(fetchImpl) {
  const elements = {};
  const get = id => (elements[id] ||= createElement());
  const calls = [];
  const document = {
    body: createElement("body"),
    getElementById: get,
    querySelector: () => (elements.__query ||= createElement()),
    querySelectorAll: () => [],
    createElement
  };
  const context = {
    document,
    window: { setTimeout, clearTimeout, scrollTo() {} },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      return fetchImpl(body);
    },
    crypto: webcrypto,
    AbortController,
    console
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { get, calls };
}

const ok = data => ({ ok: true, json: async () => ({ ok: true, data }) });
const base = (tawkeel, rami, version = 1) => ({
  seasonYear: "1448",
  version,
  recordRef: "a".repeat(64),
  record: { name: "حاج اصطناعي", tawkeel, rami, slaughter: "not_done" }
});

async function search(app) {
  app.get("searchValue").value = "0012345678";
  await app.get("searchForm").fire("submit");
}

test("action buttons are enabled after a successful lookup of an incomplete record", async () => {
  const app = createApp(body => ok(body.action === "pilgrim.season" ? { year: "1448" } : base(false, false)));
  await search(app);
  const [tawkeel] = app.get("tawkeelActions").children;
  const [rami] = app.get("ramiActions").children;
  assert.equal(tawkeel.textContent, "قراءة التوكيل وتأكيده");
  assert.equal(rami.textContent, "تأكيد إتمام الرمي");
  assert.equal(tawkeel.disabled, false);
  assert.equal(rami.disabled, false);
});

test("opening dialogs never writes by itself, and consent gates the confirm button", async () => {
  const app = createApp(body => {
    if (body.action === "pilgrim.season") return ok({ year: "1448" });
    if (body.action === "pilgrim.proxyText") return ok({ text: "نص اصطناعي", revision: "b".repeat(64) });
    return ok(base(false, false));
  });
  await search(app);

  await app.get("tawkeelActions").children[0].fire("click");
  assert.equal(app.get("proxyDialog").open, true);
  assert.equal(app.get("proxyText").textContent, "نص اصطناعي");
  assert.equal(app.get("proxyConfirmButton").disabled, true);
  app.get("proxyConsent").checked = true;
  await app.get("proxyConsent").fire("change");
  assert.equal(app.get("proxyConfirmButton").disabled, false);

  await app.get("ramiActions").children[0].fire("click");
  assert.equal(app.get("confirmDialog").open, true);
  assert.equal(app.calls.some(call => /\.(confirm|correct)$/.test(call.action)), false);
});

test("buttons are disabled only during a real write and a second request is ignored", async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const app = createApp(async body => {
    if (body.action === "pilgrim.season") return ok({ year: "1448" });
    if (body.action === "pilgrim.rami.confirm") {
      await pending;
      return ok({ ...base(false, true, 2), changed: true });
    }
    return ok(base(false, false));
  });
  await search(app);
  await app.get("ramiActions").children[0].fire("click");

  const first = app.get("confirmDialogAccept").fire("click");
  await settle();
  const second = app.get("confirmDialogAccept").fire("click");
  await settle();
  assert.equal(app.calls.filter(call => call.action === "pilgrim.rami.confirm").length, 1);
  assert.equal(app.get("ramiActions").children[0].disabled, true);
  assert.equal(app.get("tawkeelActions").children[0].disabled, true);

  release();
  await Promise.all([first, second]);
  await settle();
  assert.equal(app.calls.filter(call => call.action === "pilgrim.rami.confirm").length, 1);
  const [rami] = app.get("ramiActions").children;
  assert.equal(rami.textContent, "تصحيح حالة الرمي");
  assert.equal(rami.disabled, false);
  assert.equal(app.get("tawkeelActions").children[0].disabled, false);
});
