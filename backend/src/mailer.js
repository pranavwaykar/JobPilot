const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const { buildEmail } = require("./template");

function assertSmtpConfig(smtp) {
  const missing = [];
  if (!smtp.host) missing.push("SMTP_HOST");
  if (!smtp.port) missing.push("SMTP_PORT");
  if (!smtp.user) missing.push("SMTP_USER");
  if (!smtp.pass) missing.push("SMTP_PASS");
  if (missing.length) {
    throw new Error(`Missing SMTP config: ${missing.join(", ")} (set these in .env)`);
  }
}

function createTransporter({ smtp, from }) {
  assertSmtpConfig(smtp);
  if (!from?.email) throw new Error("Missing FROM_EMAIL (or SMTP_USER) in .env");

  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });
}

async function sendApplicationEmail({
  transporter,
  from,
  toEmail,
  toName,
  subject,
  resumePath,
}) {
  const { text, html } = buildEmail({
    recipientName: toName,
    recipientEmail: toEmail,
    subject,
  });

  const attachments = [];
  if (resumePath) {
    const abs = path.resolve(resumePath);
    if (!fs.existsSync(abs)) {
      throw new Error(
        `Resume not found at ${abs}. Put your PDF there or set RESUME_PATH in .env`,
      );
    }
    attachments.push({
      filename: path.basename(abs),
      path: abs,
    });
  }

  return await transporter.sendMail({
    from: from.name ? `"${from.name}" <${from.email}>` : from.email,
    to: toEmail,
    subject,
    text,
    html,
    attachments,
  });
}

module.exports = { createTransporter, sendApplicationEmail };


