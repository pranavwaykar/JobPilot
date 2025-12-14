const express = require("express");
const multer = require("multer");
const os = require("os");
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");
const crypto = require("crypto");

const config = require("./config");
const { createTransporter, sendApplicationEmail } = require("./mailer");
const { buildEmail } = require("./template");
const { sleep } = require("./utils");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({
  dest: path.join(os.tmpdir(), "job-mailer-uploads"),
  limits: {
    fileSize: 12 * 1024 * 1024, // 12MB
  },
});

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeDomain(domain) {
  const d = String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  return d;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function bodyToHtml(bodyText) {
  // Basic newline -> <br/> conversion for a simple custom body.
  return `<div style="white-space:pre-wrap;font-family:system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">${escapeHtml(
    bodyText,
  )}</div>`;
}

function buildOverriddenEmail({ recipientName, recipientEmail, bodyText }) {
  const greetingName = String(recipientName || "").trim() || "Hiring Team";

  const signatureText = [
    "Warm regards,",
    "Shubham Pawar",
    "MERN Stack Developer | Software Engineer",
    "Immediate Joiner",
  ].join("\n");

  const text = [`Hi ${greetingName},`, "", String(bodyText || "").trim(), "", signatureText, ""].join(
    "\n",
  );

  const html = `
    <p>Hi ${escapeHtml(greetingName)},</p>
    ${bodyToHtml(String(bodyText || "").trim())}
    <p>
      Warm regards,<br />
      Shubham Pawar<br />
      MERN Stack Developer | Software Engineer<br />
      Immediate Joiner
    </p>
  `.trim();

  return { text, html };
}

function pickFirstNonEmpty(...vals) {
  for (const v of vals) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

function parseRecipientsFromXlsx(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  // expected columns (case-insensitive):
  // - email / mail
  // - recipient name / name
  // - subject
  // - body
  const out = [];
  for (const r of rows) {
    const email = normalizeEmail(
      pickFirstNonEmpty(
        r.email,
        r.Email,
        r.EMAIL,
        r.mail,
        r.Mail,
        r.MAIL,
        r["email id"],
        r["Email Id"],
        r["EMAIL ID"],
        r["mail id"],
        r["Mail Id"],
        r["MAIL ID"],
        r["email address"],
        r["Email Address"],
        r["EMAIL ADDRESS"],
      ),
    );
    if (!email || !isValidEmail(email)) continue;
    const name = pickFirstNonEmpty(
      r["recipient name"],
      r["Recipient Name"],
      r["RECIPIENT NAME"],
      r["receipnt name"], // common typo
      r["Receipnt Name"],
      r["RECEIPNT NAME"],
      r.name,
      r.Name,
      r.NAME,
    ).trim();
    const subject = pickFirstNonEmpty(r.subject, r.Subject, r.SUBJECT).trim();
    const body = pickFirstNonEmpty(r.body, r.Body, r.BODY).trim();
    out.push({ email, name, subject, body });
  }

  // de-dupe by email (keep first non-empty values)
  const seen = new Map();
  for (const row of out) {
    if (!seen.has(row.email)) {
      seen.set(row.email, row);
      continue;
    }
    const existing = seen.get(row.email);
    if (!existing.name && row.name) existing.name = row.name;
    if (!existing.subject && row.subject) existing.subject = row.subject;
    if (!existing.body && row.body) existing.body = row.body;
  }
  return Array.from(seen.values());
}

function buildTemplateWorkbookBuffer() {
  const header = [["email", "recipient name", "subject", "body"]];
  const sample = [
    ["hr@company.com", "Hiring Team", "", ""],
    ["recruiter@company.com", "Priya", "Application for MERN Stack Developer Role — Immediate Joiner | 3 Yrs Experience", ""],
  ];
  const aoa = header.concat(sample);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "recipients");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

const UI_DIR = path.resolve(__dirname, "..", "..", "frontend", "public");
const LOGIN_PATH = path.resolve(UI_DIR, "login.html");

// -------------------------
// Auth (simple local login)
// -------------------------
const AUTH_USER = String(process.env.UI_AUTH_USER || "").trim();
const AUTH_PASS = String(process.env.UI_AUTH_PASS || "").trim();
const AUTH_ENABLED = Boolean(AUTH_USER && AUTH_PASS);
const COOKIE_NAME = "jm_sid";
const sessions = new Map(); // sid -> { createdAt, expiresAt }
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function createSession() {
  const sid = crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  sessions.set(sid, { createdAt: now, expiresAt: now + SESSION_TTL_MS });
  return sid;
}

function isAuthenticated(req) {
  if (!AUTH_ENABLED) return true;
  const cookies = parseCookies(req);
  const sid = cookies[COOKIE_NAME];
  if (!sid) return false;
  const s = sessions.get(sid);
  if (!s) return false;
  if (Date.now() > s.expiresAt) {
    sessions.delete(sid);
    return false;
  }
  return true;
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  const isApi = req.path.startsWith("/api/");
  if (isApi) return res.status(401).json({ ok: false, error: "Unauthorized. Please login." });
  return res.redirect("/login");
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/login", (_req, res) => {
  if (!AUTH_ENABLED) {
    return res
      .status(200)
      .send(
        "Auth is disabled. Set UI_AUTH_USER and UI_AUTH_PASS in .env (or env.example) to enable login.",
      );
  }
  return res.sendFile(LOGIN_PATH);
});

app.post("/api/login", (req, res) => {
  if (!AUTH_ENABLED) return res.json({ ok: true, authEnabled: false });
  const user = String(req.body.user || "").trim();
  const pass = String(req.body.pass || "").trim();
  if (user !== AUTH_USER || pass !== AUTH_PASS) {
    return res.status(401).json({ ok: false, error: "Invalid username or password." });
  }
  const sid = createSession();
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(
      sid,
    )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  );
  return res.json({ ok: true, authEnabled: true });
});

app.post("/api/logout", (req, res) => {
  const cookies = parseCookies(req);
  const sid = cookies[COOKIE_NAME];
  if (sid) sessions.delete(sid);
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`);
  return res.json({ ok: true });
});

// Protect everything (UI + API) except health + login endpoints.
app.use((req, res, next) => {
  if (!AUTH_ENABLED) return next();
  if (req.path === "/health") return next();
  if (req.path === "/login") return next();
  if (req.path === "/api/login") return next();
  return requireAuth(req, res, next);
});

// Serve UI (protected if auth enabled)
app.use(express.static(UI_DIR));

// -------------------------
// HR / Talent lookup (optional)
// -------------------------
const HUNTER_API_KEY = String(process.env.HUNTER_API_KEY || "").trim();
const HR_PROVIDER_DEFAULT = String(process.env.HR_PROVIDER || "hunter").trim().toLowerCase();

// Apollo.io (people database) integration (requires Apollo.io API key)
const APOLLO_API_KEY = String(process.env.APOLLO_API_KEY || "").trim();
const APOLLO_BASE_URL = String(process.env.APOLLO_BASE_URL || "https://api.apollo.io").trim();
const APOLLO_ENDPOINT = String(process.env.APOLLO_ENDPOINT || "/v1/mixed_people/search").trim();

function looksLikeApolloGraphOSKey(key) {
  const k = String(key || "").trim();
  return k.startsWith("service:");
}

// Provider status for UI (no secrets returned)
app.get("/api/provider-status", (_req, res) => {
  res.json({
    ok: true,
    providers: {
      hunter: { configured: Boolean(HUNTER_API_KEY) },
      apollo: {
        configured: Boolean(APOLLO_API_KEY),
        looksLikeGraphOS: looksLikeApolloGraphOSKey(APOLLO_API_KEY),
      },
    },
  });
});

function isRecruitingRole(s) {
  const v = String(s || "").toLowerCase();
  return (
    v.includes("talent") ||
    v.includes("recruit") ||
    v.includes("hr") ||
    v.includes("human resources") ||
    v.includes("people ops") ||
    v.includes("people operations")
  );
}

async function resolveDomainFromCompany(company) {
  const q = String(company || "").trim();
  if (!q) return null;
  const url = `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) return null;
  const arr = await r.json().catch(() => []);
  const first = Array.isArray(arr) ? arr[0] : null;
  const domain = normalizeDomain(first?.domain || first?.website || "");
  return domain || null;
}

async function hunterDomainSearch(domain) {
  if (!HUNTER_API_KEY) {
    throw new Error("HUNTER_API_KEY is not set on the server.");
  }
  const d = normalizeDomain(domain);
  if (!d) throw new Error("Valid domain is required (example: company.com)");

  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(
    d,
  )}&api_key=${encodeURIComponent(HUNTER_API_KEY)}`;
  const r = await fetch(url);
  const payload = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = payload?.errors?.[0]?.details || payload?.errors?.[0]?.message || "Hunter request failed";
    throw new Error(msg);
  }
  return payload;
}

function recruitingTitleKeywords() {
  return [
    "Talent Acquisition",
    "Recruiter",
    "Recruitment",
    "HR",
    "Human Resources",
    "People Operations",
    "People Ops",
  ];
}

async function apolloPeopleSearch(domain) {
  if (!APOLLO_API_KEY) {
    throw new Error("APOLLO_API_KEY is not set on the server.");
  }
  if (looksLikeApolloGraphOSKey(APOLLO_API_KEY)) {
    throw new Error(
      "APOLLO_API_KEY looks like an Apollo GraphOS (service:...) key. HR Finder Apollo needs an Apollo.io API key.",
    );
  }
  const d = normalizeDomain(domain);
  if (!d) throw new Error("Valid domain is required (example: company.com)");

  // NOTE: Apollo.io APIs and response shapes can vary by plan and may change.
  // This is implemented as a best-effort integration; if your Apollo account uses
  // a different endpoint/shape, set APOLLO_ENDPOINT/APOLLO_BASE_URL and we can adjust mapping.
  const url = `${APOLLO_BASE_URL}${APOLLO_ENDPOINT}`;
  const body = {
    api_key: APOLLO_API_KEY,
    q_organization_domains: d,
    page: 1,
    per_page: 25,
    person_titles: recruitingTitleKeywords(),
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await r.json().catch(() => null);
  if (!r.ok) {
    if (r.status === 401) {
      throw new Error(
        "Apollo request failed (401). This usually means the API key is invalid or not an Apollo.io API key.",
      );
    }
    const msg =
      payload?.error ||
      payload?.message ||
      payload?.errors?.[0] ||
      `Apollo request failed (${r.status})`;
    throw new Error(String(msg));
  }
  return payload;
}

app.get("/api/hr-lookup", async (req, res) => {
  try {
    const company = String(req.query.company || "").trim();
    const domainInput = normalizeDomain(req.query.domain || "");
    const provider = String(req.query.provider || HR_PROVIDER_DEFAULT || "hunter")
      .trim()
      .toLowerCase();

    let domain = domainInput;
    if (!domain && company) {
      domain = (await resolveDomainFromCompany(company)) || "";
    }
    if (!domain) {
      return res.status(400).json({
        ok: false,
        error:
          "Provide a company domain (recommended) or a company name (domain will be auto-detected when possible).",
      });
    }

    if (provider === "apollo") {
      const apollo = await apolloPeopleSearch(domain);
      const people =
        apollo?.people || apollo?.contacts || apollo?.data?.people || apollo?.data?.contacts || [];

      const contacts = (Array.isArray(people) ? people : [])
        .map((p) => {
          const email = String(p?.email || p?.email_address || p?.emailAddress || "").trim().toLowerCase();
          if (!isValidEmail(email)) return null;
          const first = p?.first_name || p?.firstName || "";
          const last = p?.last_name || p?.lastName || "";
          const name = String(`${first} ${last}`.trim());
          const position = p?.title || p?.job_title || p?.position || "";
          return {
            email,
            name,
            position: String(position || ""),
            seniority: String(p?.seniority || ""),
            confidence: null,
            source: "apollo",
          };
        })
        .filter(Boolean)
        .slice(0, 25);

      return res.json({
        ok: true,
        provider,
        company,
        domain,
        contacts,
        mode: "recruiting_only",
        phone: null,
      });
    }

    // Default: Hunter
    const hunter = await hunterDomainSearch(domain);
    const data = hunter?.data || {};
    const emails = Array.isArray(data.emails) ? data.emails : [];
    const org = data.organization || {};
    const phone =
      org.phone_number ||
      org.phone ||
      org.phoneNumber ||
      data.phone_number ||
      data.phone ||
      data.company_phone ||
      null;

    const allContacts = emails
      .filter((e) => isValidEmail(e?.value))
      .map((e) => {
        const firstName = e?.first_name || "";
        const lastName = e?.last_name || "";
        const fullName = `${firstName} ${lastName}`.trim();
        const position = e?.position || e?.department || "";
        const seniority = e?.seniority || "";
        return {
          email: String(e.value).toLowerCase(),
          name: fullName,
          position,
          seniority,
          confidence: e?.confidence ?? null,
          source: "hunter",
        };
      })
      .slice(0, 50);

    const recruitingContacts = allContacts
      .filter((c) => isRecruitingRole(`${c.position} ${c.seniority}`))
      .slice(0, 25);

    const contacts =
      recruitingContacts.length > 0 ? recruitingContacts : allContacts.slice(0, 25);

    return res.json({
      ok: true,
      provider: "hunter",
      company,
      domain,
      contacts,
      mode: recruitingContacts.length > 0 ? "recruiting_only" : "all_emails_fallback",
      phone: phone ? String(phone) : null,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Downloadable Excel template
app.get("/api/template.xlsx", (_req, res) => {
  console.log("[ui] template download: /api/template.xlsx");
  const buf = buildTemplateWorkbookBuffer();
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", 'attachment; filename="job-mailer-template.xlsx"');
  res.send(buf);
});

// Alias (in case you prefer a shorter URL)
app.get("/template.xlsx", (_req, res) => {
  console.log("[ui] template download: /template.xlsx");
  const buf = buildTemplateWorkbookBuffer();
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", 'attachment; filename="job-mailer-template.xlsx"');
  res.send(buf);
});

app.post("/api/send", upload.single("resume"), async (req, res) => {
  const toEmail = normalizeEmail(req.body.email);
  const toName = String(req.body.name || "").trim();
  const subjectOverride = String(req.body.subject || "").trim();
  const bodyOverride = String(req.body.body || "").trim();

  if (!toEmail || !isValidEmail(toEmail)) {
    return res.status(400).json({ ok: false, error: "Valid email is required." });
  }

  const subject = subjectOverride || config.content.subject;

  // Decide content: override only if user provided body.
  let text;
  let html;
  if (bodyOverride) {
    const overridden = buildOverriddenEmail({
      recipientName: toName,
      recipientEmail: toEmail,
      bodyText: bodyOverride,
    });
    text = overridden.text;
    html = overridden.html;
  } else {
    const built = buildEmail({
      recipientName: toName,
      recipientEmail: toEmail,
      subject,
    });
    text = built.text;
    html = built.html;
  }

  const resumePath = req.file?.path ? req.file.path : config.paths.resumePath;

  try {
    const transporter = createTransporter({ smtp: config.smtp, from: config.from });

    // Reuse sender but with our custom text/html when bodyOverride is present.
    const info = bodyOverride
      ? await transporter.sendMail({
          from: config.from.name ? `"${config.from.name}" <${config.from.email}>` : config.from.email,
          to: toEmail,
          subject,
          text,
          html,
          attachments: [
            {
              filename: req.file?.originalname || path.basename(resumePath),
              path: resumePath,
            },
          ],
        })
      : await sendApplicationEmail({
          transporter,
          from: config.from,
          toEmail,
          toName,
          subject,
          resumePath,
        });

    res.json({
      ok: true,
      toEmail,
      subject,
      messageId: info.messageId,
      response: info.response,
      usedDefaults: {
        subject: !subjectOverride,
        body: !bodyOverride,
        resume: !req.file,
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  } finally {
    // Clean up uploaded file if present.
    if (req.file?.path) {
      fs.promises.unlink(req.file.path).catch(() => {});
    }
  }
});

// Bulk send from Excel:
// - excel is required
// - resume is optional (applies to all rows)
// - for each row, subject/body/name can override; otherwise defaults apply
app.post(
  "/api/send-bulk",
  upload.fields([
    { name: "excel", maxCount: 1 },
    { name: "resume", maxCount: 1 },
  ]),
  async (req, res) => {
    const excelFile = req.files?.excel?.[0];
    const resumeFile = req.files?.resume?.[0];
    if (!excelFile?.path) {
      return res.status(400).json({ ok: false, error: "Excel (.xlsx) file is required." });
    }

    console.log(
      `[ui] bulk send requested: excel=${excelFile.originalname} (${excelFile.size} bytes) resume=${
        resumeFile?.originalname || "(default)"
      }`,
    );

    let rows = [];
    try {
      rows = parseRecipientsFromXlsx(excelFile.path);
    } catch (e) {
      return res.status(400).json({
        ok: false,
        error: `Failed to read Excel. Make sure it's a valid .xlsx with columns: email, recipient name, subject, body. (${String(
          e?.message || e,
        )})`,
      });
    } finally {
      fs.promises.unlink(excelFile.path).catch(() => {});
    }

    if (!rows.length) {
      if (resumeFile?.path) fs.promises.unlink(resumeFile.path).catch(() => {});
      return res.status(400).json({
        ok: false,
        error:
          "No valid rows found. Ensure your sheet has an 'email' (or 'mail') column with valid emails.",
      });
    }

    console.log(`[ui] bulk parsed rows: ${rows.length}`);

    const resumePath = resumeFile?.path ? resumeFile.path : config.paths.resumePath;
    const transporter = createTransporter({ smtp: config.smtp, from: config.from });

    const results = [];
    for (const r of rows) {
      const subject = r.subject || config.content.subject;
      const bodyOverride = r.body || "";

      let text;
      let html;
      if (bodyOverride) {
        const overridden = buildOverriddenEmail({
          recipientName: r.name,
          recipientEmail: r.email,
          bodyText: bodyOverride,
        });
        text = overridden.text;
        html = overridden.html;
      } else {
        const built = buildEmail({
          recipientName: r.name,
          recipientEmail: r.email,
          subject,
        });
        text = built.text;
        html = built.html;
      }

      try {
        console.log(`[ui] bulk sending -> ${r.email}`);
        const info = await transporter.sendMail({
          from: config.from.name ? `"${config.from.name}" <${config.from.email}>` : config.from.email,
          to: r.email,
          subject,
          text,
          html,
          attachments: [
            {
              filename: resumeFile?.originalname || path.basename(resumePath),
              path: resumePath,
            },
          ],
        });
        console.log(`[ui] bulk sent OK -> ${r.email} (messageId=${info.messageId || "n/a"})`);
        results.push({ email: r.email, ok: true, messageId: info.messageId, response: info.response });
      } catch (e) {
        console.error(`[ui] bulk send FAILED -> ${r.email}: ${String(e?.message || e)}`);
        results.push({ email: r.email, ok: false, error: String(e?.message || e) });
      }

      await sleep(config.behavior.delayMsBetweenEmails);
    }

    if (resumeFile?.path) fs.promises.unlink(resumeFile.path).catch(() => {});

    const sent = results.filter((x) => x.ok).length;
    const failed = results.length - sent;
    res.json({ ok: true, total: results.length, sent, failed, results });
  },
);

const HOST = String(process.env.UI_HOST || "127.0.0.1");
const PORT = Number(process.env.UI_PORT || 4545);
const server = app.listen(PORT, HOST, () => {
  const shownHost = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`UI running at http://${shownHost}:${PORT}`);
  console.log(`Env loaded from: ${config.meta?.loadedEnvFile || "(unknown)"}`);
  console.log(
    `Auth enabled: ${AUTH_ENABLED ? "yes" : "no"}${
      AUTH_ENABLED ? "" : " (set UI_AUTH_USER/UI_AUTH_PASS to enable)"
    }`,
  );
});

server.on("error", (err) => {
  console.error("UI server failed to start:", err?.message || err);
  process.exitCode = 1;
});


