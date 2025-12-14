function guessGreetingFromEmail(email) {
  const e = String(email || "").toLowerCase();
  const hrHints = ["hr", "hiring", "recruit", "talent", "peopleops", "people-ops"];
  if (hrHints.some((h) => e.includes(h))) return "Hiring Team";
  return "Hiring Team";
}

function buildEmail({ recipientName, recipientEmail, subject }) {
  const name = String(recipientName || "").trim();
  const greetingName = name || guessGreetingFromEmail(recipientEmail);

  const text = [
    `Hi ${greetingName},`,
    "",
    "I hope you’re doing well. My name is Shubham Pawar, and I am writing to apply for the MERN Stack Developer position at your organization. I have 3 years of hands-on experience building scalable, high-performance web applications using React.js, Node.js, TypeScript, Microservices, PostgreSQL, MongoDB, SSO, and SSE.",
    "",
    "In my recent roles, I have:",
    "- Built responsive, pixel-perfect UIs using React.js and modern frontend architecture",
    "- Developed secure backend APIs and microservices",
    "- Implemented real-time features using Server-Sent Events (SSE)",
    "- Improved performance through caching, state optimization, memoization & API tuning",
    "- Delivered end-to-end features in fast-paced product environments",
    "- Collaborated with Product, QA, and DevOps to ensure smooth and timely delivery",
    "",
    "I want to highlight that I am an IMMEDIATE JOINER, fully available to start right away without any notice period.",
    "",
    "Here are my key links for quick review:",
    "LinkedIn: https://www.linkedin.com/in/shubhampawar-",
    "Portfolio: https://shubhamsportfoliosite.netlify.app/",
    "Email: pawarshubham1295@gmail.com",
    "Contact: 7020567907",
    "",
    "I would greatly appreciate the opportunity to discuss how my MERN expertise and hands-on project experience can contribute to your engineering team.",
    "",
    "Thank you for your time, and I look forward to the possibility of connecting.",
    "",
    "Warm regards,",
    "Shubham Pawar",
    "MERN Stack Developer | Software Engineer",
    "Immediate Joiner",
    "",
  ].join("\n");

  const html = `
    <p>Hi ${escapeHtml(greetingName)},</p>
    <p>
      I hope you’re doing well. My name is Shubham Pawar, and I am writing to apply for the MERN Stack Developer position at your organization.
      I have 3 years of hands-on experience building scalable, high-performance web applications using React.js, Node.js, TypeScript, Microservices,
      PostgreSQL, MongoDB, SSO, and SSE.
    </p>
    <p>In my recent roles, I have:</p>
    <ul>
      <li>Built responsive, pixel-perfect UIs using React.js and modern frontend architecture</li>
      <li>Developed secure backend APIs and microservices</li>
      <li>Implemented real-time features using Server-Sent Events (SSE)</li>
      <li>Improved performance through caching, state optimization, memoization &amp; API tuning</li>
      <li>Delivered end-to-end features in fast-paced product environments</li>
      <li>Collaborated with Product, QA, and DevOps to ensure smooth and timely delivery</li>
    </ul>
    <p><strong>I am an IMMEDIATE JOINER</strong>, fully available to start right away without any notice period.</p>
    <p>Here are my key links for quick review:</p>
    <ul>
      <li>LinkedIn: <a href="https://www.linkedin.com/in/shubhampawar-">https://www.linkedin.com/in/shubhampawar-</a></li>
      <li>Portfolio: <a href="https://shubhamsportfoliosite.netlify.app/">https://shubhamsportfoliosite.netlify.app/</a></li>
      <li>Email: <a href="mailto:pawarshubham1295@gmail.com">pawarshubham1295@gmail.com</a></li>
      <li>Contact: 7020567907</li>
    </ul>
    <p>
      I would greatly appreciate the opportunity to discuss how my MERN expertise and hands-on project experience can contribute to your engineering team.
    </p>
    <p>Thank you for your time, and I look forward to the possibility of connecting.</p>
    <p>
      Warm regards,<br />
      Shubham Pawar<br />
      MERN Stack Developer | Software Engineer<br />
      Immediate Joiner
    </p>
  `.trim();

  return { subject, text, html };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

module.exports = { buildEmail };


