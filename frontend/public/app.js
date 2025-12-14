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


