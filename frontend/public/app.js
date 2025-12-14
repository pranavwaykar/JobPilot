const $ = (sel) => document.querySelector(sel);

const form = $("#sendForm");
const statusEl = $("#status");
const sendBtn = $("#sendBtn");
const spinner = $(".btnSpinner");
const resetBtn = $("#resetBtn");

const dropzone = $("#dropzone");
const resumeInput = $("#resume");
const filePill = $("#filePill");
const fileName = $("#fileName");
const clearFile = $("#clearFile");

const excelInput = $("#excel");
const bulkResumeInput = $("#bulkResume");
const bulkSendBtn = $("#bulkSendBtn");
const logoutBtn = $("#logoutBtn");

// Tabs
const tabSend = $("#tabSend");
const tabHr = $("#tabHr");
const panelSend = $("#panelSend");
const panelHr = $("#panelHr");
const panelSide = $("#panelSide");

// HR finder
const hrSearchBtn = $("#hrSearchBtn");
const hrCopyBtn = $("#hrCopyBtn");
const hrCopyPhoneBtn = $("#hrCopyPhoneBtn");
const hrResults = $("#hrResults");
const providerSel = $("#provider");
let lastHrContacts = [];
let lastHrPhone = "";

async function initProviderStatus() {
  try {
    const res = await fetch("/api/provider-status");
    const data = await res.json().catch(() => ({}));
    if (!providerSel) return;
    const apolloOpt = providerSel.querySelector('option[value="apollo"]');
    if (!apolloOpt) return;
    const apollo = data?.providers?.apollo || {};

    if (!apollo.configured) {
      apolloOpt.disabled = true;
      apolloOpt.textContent = "Apollo (set APOLLO_API_KEY)";
      return;
    }
    if (apollo.looksLikeGraphOS) {
      apolloOpt.disabled = true;
      apolloOpt.textContent = "Apollo (GraphOS key detected — needs Apollo.io key)";
      return;
    }
  } catch {
    // ignore
  }
}

function toast(type, title, msg, { timeoutMs = 3500 } = {}) {
  let wrap = document.querySelector(".toastWrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "toastWrap";
    document.body.appendChild(wrap);
  }

  const el = document.createElement("div");
  el.className = `toast ${type === "bad" ? "bad" : "good"}`;
  el.innerHTML = `<div class="toastTitle">${escapeHtml(title)}</div><div class="toastMsg">${escapeHtml(
    msg || "",
  )}</div>`;
  wrap.appendChild(el);

  const remove = () => {
    el.classList.add("toastOut");
    setTimeout(() => el.remove(), 170);
  };

  setTimeout(remove, timeoutMs);
  el.addEventListener("click", remove);
}

function setStatus(type, html) {
  statusEl.classList.remove("empty", "good", "bad");
  statusEl.classList.add(type);
  statusEl.innerHTML = html;
}

function setLoading(isLoading) {
  sendBtn.disabled = isLoading;
  if (isLoading) spinner.classList.remove("hidden");
  else spinner.classList.add("hidden");
}

function setTab(which) {
  const isSend = which === "send";
  const isHr = which === "hr";
  tabSend?.classList.toggle("active", isSend);
  tabHr?.classList.toggle("active", isHr);
  panelSend?.classList.toggle("hidden", !isSend);
  panelHr?.classList.toggle("hidden", !isHr);
  // Keep the right-side status visible for send; hide for other tabs to give space.
  panelSide?.classList.toggle("hidden", !isSend);
}

tabSend?.addEventListener("click", () => setTab("send"));
tabHr?.addEventListener("click", () => setTab("hr"));

initProviderStatus();

function updateFileUI() {
  const f = resumeInput.files && resumeInput.files[0];
  if (!f) {
    filePill.classList.add("hidden");
    fileName.textContent = "";
    return;
  }
  filePill.classList.remove("hidden");
  fileName.textContent = `${f.name} (${Math.round(f.size / 1024)} KB)`;
}

resumeInput.addEventListener("change", updateFileUI);
clearFile.addEventListener("click", () => {
  resumeInput.value = "";
  updateFileUI();
});

function prevent(e) {
  e.preventDefault();
  e.stopPropagation();
}

["dragenter", "dragover"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    prevent(e);
    dropzone.classList.add("drag");
  });
});

["dragleave", "drop"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    prevent(e);
    dropzone.classList.remove("drag");
  });
});

dropzone.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f) return;
  if (!f.name.toLowerCase().endsWith(".pdf")) {
    setStatus("bad", "<strong>Resume must be a PDF.</strong>");
    return;
  }
  const dt = new DataTransfer();
  dt.items.add(f);
  resumeInput.files = dt.files;
  updateFileUI();
});

resetBtn.addEventListener("click", () => {
  form.reset();
  resumeInput.value = "";
  updateFileUI();
  statusEl.className = "status empty";
  statusEl.textContent = "Fill the form and click Send Email.";
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = $("#email").value.trim();
  if (!email) {
    setStatus("bad", "<strong>Email is required.</strong>");
    return;
  }

  setLoading(true);
  setStatus("empty", "Sending…");

  const fd = new FormData();
  fd.set("email", email);
  fd.set("name", $("#name").value.trim());
  fd.set("subject", $("#subject").value.trim());
  fd.set("body", $("#body").value.trim());

  const f = resumeInput.files && resumeInput.files[0];
  if (f) fd.set("resume", f);

  try {
    const res = await fetch("/api/send", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      const err = data.error || `Request failed (${res.status})`;
      setStatus("bad", `<strong>Failed.</strong><br/>${escapeHtml(err)}`);
      toast("bad", "Email failed", err);
      return;
    }

    const defaults = data.usedDefaults || {};
    setStatus(
      "good",
      `<strong>Sent!</strong><br/>
      To: <code>${escapeHtml(data.toEmail)}</code><br/>
      Subject: <code>${escapeHtml(data.subject || "")}</code><br/>
      <div style="margin-top:10px;color:rgba(255,255,255,.75)">
        Used defaults: subject=${defaults.subject ? "yes" : "no"}, body=${
        defaults.body ? "yes" : "no"
      }, resume=${defaults.resume ? "yes" : "no"}
      </div>`,
    );
    toast("good", "Email sent", data.toEmail);
  } catch (err) {
    const msg = String(err?.message || err);
    setStatus("bad", `<strong>Error.</strong><br/>${escapeHtml(msg)}`);
    toast("bad", "Error", msg);
  } finally {
    setLoading(false);
  }
});

logoutBtn?.addEventListener("click", async () => {
  try {
    await fetch("/api/logout", { method: "POST" });
  } catch {}
  window.location.href = "/login";
});

function renderHrResults(contacts, meta = {}) {
  lastHrContacts = Array.isArray(contacts) ? contacts : [];
  lastHrPhone = meta.phone || "";
  if (!lastHrContacts.length) {
    hrResults.className = "status empty";
    hrResults.innerHTML = "No HR / Talent contacts found.";
    return;
  }

  const cards = lastHrContacts
    .map((c) => {
      const name = c.name ? escapeHtml(c.name) : "Hiring Team";
      const pos = c.position ? escapeHtml(c.position) : "HR / Talent";
      const email = c.email ? escapeHtml(c.email) : "—";
      const conf =
        c.confidence === null || c.confidence === undefined ? "—" : escapeHtml(String(c.confidence));
      return `
        <div class="hrCard">
          <div class="hrName">${name}</div>
          <div class="hrRole">${pos}</div>
          <div class="hrEmailRow">
            <code class="hrEmail" title="${email}">${email}</code>
            <button class="iconBtn js-copy-email" type="button" data-email="${email}" title="Copy email">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M9 9h10v10H9V9Z" stroke="currentColor" stroke-width="2" />
                <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="2" />
              </svg>
            </button>
          </div>
          <div class="hrBottomRow">
            <span class="hrBadge">Confidence</span>
            <span class="hrBadge">${conf}</span>
          </div>
        </div>
      `;
    })
    .join("");

  hrResults.className = "status";
  hrResults.innerHTML = `
    <div style="margin-bottom:10px;color:rgba(255,255,255,.75)">
      <div class="hrMetaRow">
        <div>
          Found <strong>${lastHrContacts.length}</strong> contacts for
          <code>${escapeHtml(meta.domain || meta.company || "—")}</code>
        </div>
        ${
          meta.phone
            ? `<div style="color:rgba(255,255,255,.78)">Company phone: <code>${escapeHtml(
                meta.phone,
              )}</code></div>`
            : ""
        }
      </div>
      ${
        meta.mode === "all_emails_fallback"
          ? `<div style="margin-top:6px;color:rgba(255,211,109,.9)"><strong>Note:</strong> HR/TA roles not available for this domain; showing all discovered emails.</div>`
          : ""
      }
    </div>
    <div class="hrCards">${cards}</div>
  `;
}

hrResults?.addEventListener("click", async (e) => {
  const btn = e.target?.closest?.(".js-copy-email");
  if (!btn) return;
  const email = btn.getAttribute("data-email") || "";
  if (!email || email === "—") {
    toast("bad", "Copy failed", "No email to copy");
    return;
  }
  try {
    await navigator.clipboard.writeText(email);
    toast("good", "Copied", email);
  } catch {
    toast("bad", "Copy failed", "Browser blocked clipboard. Copy manually.");
  }
});

hrSearchBtn?.addEventListener("click", async () => {
  const company = ($("#company")?.value || "").trim();
  const domain = ($("#domain")?.value || "").trim();
  const provider = (providerSel?.value || "hunter").trim();

  if (!company && !domain) {
    toast("bad", "Missing input", "Enter company name or domain.");
    return;
  }

  hrResults.className = "status empty";
  hrResults.innerHTML = "Searching…";

  try {
    const qs = new URLSearchParams();
    if (company) qs.set("company", company);
    if (domain) qs.set("domain", domain);
    if (provider) qs.set("provider", provider);
    const res = await fetch(`/api/hr-lookup?${qs.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      const err = data.error || `Request failed (${res.status})`;
      hrResults.className = "status bad";
      hrResults.innerHTML = `<strong>Failed.</strong><br/>${escapeHtml(err)}`;
      toast("bad", "HR lookup failed", err);
      return;
    }
    renderHrResults(data.contacts || [], {
      domain: data.domain,
      company: data.company,
      mode: data.mode,
      phone: data.phone,
    });
    toast("good", "HR lookup complete", `${(data.contacts || []).length} contacts found`);
  } catch (e) {
    const msg = String(e?.message || e);
    hrResults.className = "status bad";
    hrResults.innerHTML = `<strong>Error.</strong><br/>${escapeHtml(msg)}`;
    toast("bad", "Error", msg);
  }
});

hrCopyBtn?.addEventListener("click", async () => {
  const emails = (lastHrContacts || []).map((c) => c.email).filter(Boolean);
  if (!emails.length) {
    toast("bad", "Nothing to copy", "Search first to get emails.");
    return;
  }
  const text = emails.join("\n");
  try {
    await navigator.clipboard.writeText(text);
    toast("good", "Copied", `${emails.length} emails copied`);
  } catch {
    toast("bad", "Copy failed", "Browser blocked clipboard. Select and copy manually.");
  }
});

hrCopyPhoneBtn?.addEventListener("click", async () => {
  if (!lastHrPhone) {
    toast("bad", "No phone found", "This provider did not return a company phone number.");
    return;
  }
  try {
    await navigator.clipboard.writeText(String(lastHrPhone));
    toast("good", "Copied", "Phone number copied");
  } catch {
    toast("bad", "Copy failed", "Browser blocked clipboard. Copy manually from the result.");
  }
});

bulkSendBtn?.addEventListener("click", async () => {
  const excel = excelInput?.files?.[0];
  if (!excel) {
    setStatus("bad", "<strong>Excel (.xlsx) is required for bulk send.</strong>");
    return;
  }
  if (!excel.name.toLowerCase().endsWith(".xlsx")) {
    setStatus("bad", "<strong>Please upload a valid .xlsx file.</strong>");
    return;
  }

  setLoading(true);
  setStatus("empty", "Sending bulk emails… (this may take a bit)");

  const fd = new FormData();
  fd.set("excel", excel);
  const bulkResume = bulkResumeInput?.files?.[0];
  if (bulkResume) fd.set("resume", bulkResume);

  try {
    const res = await fetch("/api/send-bulk", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      const err = data.error || `Request failed (${res.status})`;
      setStatus("bad", `<strong>Bulk send failed.</strong><br/>${escapeHtml(err)}`);
      toast("bad", "Bulk failed", err);
      return;
    }

    const failedLines =
      (data.results || [])
        .filter((r) => !r.ok)
        .slice(0, 8)
        .map((r) => `<li><code>${escapeHtml(r.email)}</code> — ${escapeHtml(r.error || "failed")}</li>`)
        .join("") || "";

    const sentLines =
      (data.results || [])
        .filter((r) => r.ok)
        .slice(0, 8)
        .map(
          (r) =>
            `<li><code>${escapeHtml(r.email)}</code> — <span style="color:rgba(109,255,181,.9)">sent</span></li>`,
        )
        .join("") || "";

    setStatus(
      data.failed ? "bad" : "good",
      `<strong>Bulk done.</strong><br/>
      Total: <code>${data.total}</code> | Sent: <code>${data.sent}</code> | Failed: <code>${data.failed}</code>
      ${
        sentLines
          ? `<div style="margin-top:10px;color:rgba(255,255,255,.75)"><strong>Sent (sample):</strong><ul style="margin:6px 0 0 18px">${sentLines}</ul></div>`
          : ""
      }
      ${
        failedLines
          ? `<div style="margin-top:10px;color:rgba(255,255,255,.75)"><strong>Some failures:</strong><ul style="margin:6px 0 0 18px">${failedLines}</ul></div>`
          : ""
      }`,
    );
    toast(
      data.failed ? "bad" : "good",
      "Bulk complete",
      `Sent ${data.sent}/${data.total} (${data.failed} failed)`,
      { timeoutMs: 4500 },
    );
  } catch (err) {
    const msg = String(err?.message || err);
    setStatus("bad", `<strong>Error.</strong><br/>${escapeHtml(msg)}`);
    toast("bad", "Error", msg);
  } finally {
    setLoading(false);
  }
});

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


