// Once — popup controller. Pure vanilla, no build step.
// PDF parsing/filling happens here with pdf-lib (bundled as window.PDFLib).
// All AI reasoning is delegated to the local backend at API_BASE.

const API_BASE = "http://localhost:8787";
const VAULT_KEY = "once_vault";

// ---- fictional demo persona (house rules: never real personal data) ----------
const DEMO_PERSONA = {
  first_name: "Amara",
  last_name: "Okoye",
  full_name: "Amara Okoye",
  date_of_birth: "1991-04-12",
  address_line1: "144 Sunridge Avenue",
  city: "Springfield",
  state: "IL",
  postal_code: "62704",
  country: "United States",
  email: "amara.okoye@example.com",
  phone: "+1 217 555 0142",
  ssn: "000-00-0000",
  a_number: "A000000000",
  marital_status: "Married",
  spouse_name: "David Okoye",
  spouse_first_name: "David",
  spouse_last_name: "Okoye",
  occupation: "Registered Nurse",
  employer: "St. Mary Regional Hospital",
};

// ---- state -------------------------------------------------------------------
let VAULT = {};
let pdfDoc = null;          // pdf-lib PDFDocument currently loaded
let currentFields = [];     // [{id,label}]
let currentResults = [];    // [{id,value,confidence,source,sensitive}]
let currentFileName = "form.pdf";
let mode = "pdf";           // "pdf" | "html"
let htmlTabId = null;

// ---- helpers -----------------------------------------------------------------
const $ = (id) => document.getElementById(id);

function prettify(name) {
  // strip AcroForm path noise like topmostSubform[0].Page1[0].f1_1[0]
  let s = String(name).split(".").pop() || String(name);
  s = s.replace(/\[\d+\]/g, "").replace(/[_\-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function api(path, body) {
  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

async function checkBackend() {
  try {
    const r = await fetch(API_BASE + "/api/health");
    const j = await r.json();
    $("backendDot").className = "bdot up";
    $("backendDot").title = `backend up · model ${j.model}` + (j.keyConfigured ? "" : " · no key");
  } catch {
    $("backendDot").className = "bdot down";
    $("backendDot").title = "backend down — run: cd server && node server.js";
  }
}

// ---- vault -------------------------------------------------------------------
function loadVault() {
  return new Promise((resolve) => {
    chrome.storage.local.get(VAULT_KEY, (data) => {
      VAULT = data[VAULT_KEY] || {};
      renderVault();
      resolve();
    });
  });
}
function saveVault() {
  chrome.storage.local.set({ [VAULT_KEY]: VAULT }, renderVault);
}
function renderVault() {
  const keys = Object.keys(VAULT).filter((k) => VAULT[k]);
  $("vaultStatus").textContent = keys.length
    ? `${keys.length} facts saved · ${VAULT.full_name || VAULT.first_name || "you"}`
    : "empty — nothing saved yet";
}

// ---- PDF flow ----------------------------------------------------------------
async function handlePdfFile(file) {
  currentFileName = file.name || "form.pdf";
  const buf = await file.arrayBuffer();
  pdfDoc = await PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const fields = form.getFields();

  currentFields = fields
    .filter((f) => f instanceof PDFLib.PDFTextField)
    .map((f) => ({ id: f.getName(), label: prettify(f.getName()) }));

  if (!currentFields.length) {
    showFormError("This PDF has no fillable text fields Once can read.");
    return;
  }
  mode = "pdf";
  await runMapping(currentFileName.replace(/\.pdf$/i, ""));
}

async function applyToPdf() {
  const form = pdfDoc.getForm();
  for (const r of currentResults) {
    if (!r.value) continue;
    try {
      const tf = form.getTextField(r.id);
      tf.setText(String(r.value));
    } catch { /* not a text field / missing — skip */ }
  }
  const bytes = await pdfDoc.save();
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "filled-" + currentFileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---- live HTML flow ----------------------------------------------------------
function collectFieldsInPage() {
  const out = [];
  let i = 0;
  const els = document.querySelectorAll("input, textarea, select");
  els.forEach((el) => {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image", "file"].includes(type)) return;
    if (el.offsetParent === null && el.type !== "hidden") { /* still allow; keep simple */ }
    let label = "";
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) label = l.textContent.trim();
    }
    if (!label) {
      const p = el.closest("label");
      if (p) label = p.textContent.trim();
    }
    label = label || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || "";
    el.setAttribute("data-once-id", String(i));
    out.push({ id: String(i), label: (label || "field " + i).slice(0, 120) });
    i++;
  });
  return out;
}

function fillFieldsInPage(results) {
  const colors = { green: "#2e9e5b", amber: "#c98a04", red: "#d64545" };
  let filled = 0;
  results.forEach((r) => {
    const el = document.querySelector(`[data-once-id="${r.id}"]`);
    if (!el) return;
    el.style.outline = `2px solid ${colors[r.confidence] || "#c98a04"}`;
    el.style.outlineOffset = "1px";
    if (r.value && r.confidence !== "red") {
      el.value = r.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      filled++;
    }
  });
  return filled;
}

async function fillCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  htmlTabId = tab.id;
  mode = "html";

  const [{ result: fields }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: collectFieldsInPage,
  });
  if (!fields || !fields.length) {
    showFormError("No form fields found on this page.");
    return;
  }
  currentFields = fields;
  await runMapping(new URL(tab.url).hostname);
}

// ---- shared mapping + review -------------------------------------------------
async function runMapping(title) {
  $("formPanel").classList.remove("hidden");
  $("formName").textContent = title;
  $("fillSummary").textContent = "Reading the form…";
  $("reviewList").innerHTML = "";
  $("needEyes").textContent = "";
  $("receipt").classList.add("hidden");
  $("autofillBadge").textContent = "";

  let data;
  try {
    data = await api("/api/map", { fields: currentFields, profile: VAULT });
  } catch (e) {
    showFormError("Backend not reachable. Start it: cd server && node server.js");
    return;
  }
  currentResults = data.results || [];
  renderReview(data.fallback);
}

const rank = { red: 0, amber: 1, green: 2 };

function renderReview(fallback) {
  const total = currentFields.length;
  const filled = currentResults.filter((r) => r.value).length;
  const needEyes = currentResults.filter((r) => r.confidence !== "green").length;

  $("autofillBadge").textContent = `auto-filled ${filled}/${total}`;
  $("fillSummary").textContent =
    (fallback ? "local fallback · " : "understood ") + `${total} fields` +
    (mode === "pdf" ? " in this PDF" : " on this page");

  const eyes = $("needEyes");
  if (needEyes === 0) {
    eyes.className = "needeyes clear";
    eyes.textContent = "Everything is done. Nothing needs your eyes.";
  } else {
    eyes.className = "needeyes";
    eyes.textContent = `${needEyes} ${needEyes === 1 ? "thing needs" : "things need"} your eyes — everything else is done.`;
  }

  // pair results with labels, sort uncertain to the top
  const labelById = new Map(currentFields.map((f) => [String(f.id), f.label]));
  const rows = currentResults
    .map((r) => ({ ...r, label: labelById.get(String(r.id)) || r.id }))
    .sort((a, b) => (rank[a.confidence] - rank[b.confidence]));

  const list = $("reviewList");
  list.innerHTML = "";
  for (const r of rows) list.appendChild(fieldRow(r));

  $("approveBtn").classList.toggle("hidden", mode !== "pdf");
}

function fieldRow(r) {
  const wrap = document.createElement("div");
  wrap.className = `field ${r.confidence}`;

  const top = document.createElement("div");
  top.className = "field-top";
  top.innerHTML =
    `<span class="dot ${r.confidence}"></span>` +
    `<span class="field-label">${escapeHtml(r.label)}${r.sensitive ? ' <span class="sensitive-tag">confirm</span>' : ""}</span>` +
    `<button class="q" title="What does this mean?">?</button>`;

  const input = document.createElement("input");
  input.className = "val";
  input.value = r.value || "";
  input.placeholder = r.confidence === "red" ? "you decide — Once won't guess this" : "";
  input.addEventListener("input", () => {
    r.value = input.value;
    if (mode === "html") pushSingleToPage(r);
  });

  const src = document.createElement("div");
  src.className = "src";
  src.textContent = r.source || "";

  const explainBox = document.createElement("div");
  explainBox.className = "explain hidden";

  top.querySelector(".q").addEventListener("click", async () => {
    if (!explainBox.classList.contains("hidden")) { explainBox.classList.add("hidden"); return; }
    explainBox.classList.remove("hidden");
    explainBox.textContent = "Once is explaining…";
    try {
      const j = await api("/api/explain", { fieldLabel: r.label });
      explainBox.textContent = j.explanation || "No explanation available.";
    } catch {
      explainBox.textContent = "Couldn't reach the explainer.";
    }
  });

  wrap.append(top, input, src, explainBox);
  return wrap;
}

async function pushSingleToPage(r) {
  if (htmlTabId == null) return;
  await chrome.scripting.executeScript({
    target: { tabId: htmlTabId },
    func: (id, value) => {
      const el = document.querySelector(`[data-once-id="${id}"]`);
      if (el) { el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); }
    },
    args: [String(r.id), String(r.value || "")],
  });
}

async function approve() {
  if (mode === "pdf") {
    await applyToPdf();
  } else {
    const [{ result: n }] = await chrome.scripting.executeScript({
      target: { tabId: htmlTabId },
      func: fillFieldsInPage,
      args: [currentResults],
    });
    void n;
  }
  showReceipt();
}

function showReceipt() {
  const entered = currentResults.filter((r) => r.value);
  const rc = $("receipt");
  rc.classList.remove("hidden");
  rc.innerHTML =
    `<b>Done — here's what Once entered, on your behalf:</b><br>` +
    entered.map((r) => `• ${escapeHtml(labelOf(r.id))}: ${escapeHtml(r.value)}`).join("<br>") +
    `<br><br>${mode === "pdf" ? "Your filled PDF has been downloaded. " : ""}Review before you sign or submit — nothing is final without you.`;
}
function labelOf(id) {
  const f = currentFields.find((x) => String(x.id) === String(id));
  return f ? f.label : id;
}

function showFormError(msg) {
  $("formPanel").classList.remove("hidden");
  $("formName").textContent = "Once";
  $("fillSummary").textContent = "";
  $("needEyes").className = "needeyes";
  $("needEyes").textContent = msg;
  $("reviewList").innerHTML = "";
  $("autofillBadge").textContent = "";
  $("approveBtn").classList.add("hidden");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- wire up -----------------------------------------------------------------
function init() {
  checkBackend();
  loadVault();

  $("demoBtn").addEventListener("click", () => { VAULT = { ...DEMO_PERSONA }; saveVault(); });
  $("editVaultBtn").addEventListener("click", () => {
    $("intakeBox").classList.toggle("hidden");
    $("intakeText").value = Object.entries(VAULT).map(([k, v]) => `${k}: ${v}`).join("\n");
  });
  $("saveIntakeBtn").addEventListener("click", async () => {
    const text = $("intakeText").value.trim();
    if (!text) return;
    $("saveIntakeBtn").textContent = "Saving…";
    try {
      const j = await api("/api/intake", { text });
      VAULT = { ...VAULT, ...(j.profile || {}) };
      saveVault();
      $("intakeBox").classList.add("hidden");
    } catch {
      // fallback: parse "key: value" lines locally
      text.split("\n").forEach((line) => {
        const m = line.match(/^([^:]+):\s*(.+)$/);
        if (m) VAULT[m[1].trim().toLowerCase().replace(/\s+/g, "_")] = m[2].trim();
      });
      saveVault();
      $("intakeBox").classList.add("hidden");
    }
    $("saveIntakeBtn").textContent = "Save to vault";
  });

  const dz = $("dropzone");
  $("pdfInput").addEventListener("change", (e) => { if (e.target.files[0]) handlePdfFile(e.target.files[0]); });
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault(); dz.classList.remove("drag");
    const f = e.dataTransfer.files[0];
    if (f && f.type === "application/pdf") handlePdfFile(f);
  });

  $("fillPageBtn").addEventListener("click", fillCurrentPage);
  $("approveBtn").addEventListener("click", approve);
}

document.addEventListener("DOMContentLoaded", init);
