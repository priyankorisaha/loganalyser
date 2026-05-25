const nodemailer = require('nodemailer');

let transporter;

function getTransporter() {
  // Reuse a singleton transporter for performance and connection pooling stability.
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return transporter;
}

async function sendAlertEmail({ to, alertType, severity, timestamp, summary }) {
  if (!to) return;

  const from = process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER;
  const subject = `[LogLytics][${severity}] ${alertType} detected`;

  const text = [
    'Automated Alert Notification',
    '',
    `Alert Type: ${alertType}`,
    `Severity: ${severity}`,
    `Timestamp: ${timestamp}`,
    `Summary: ${summary}`,
  ].join('\n');

  // HTML body for production-style readability in common mailbox clients.
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;max-width:640px">
      <h2 style="margin-bottom:4px">LogLytics Automated Alert</h2>
      <p style="margin-top:0;color:#4b5563">A monitoring rule has triggered.</p>
      <table style="border-collapse:collapse;width:100%;margin-top:14px">
        <tr><td style="padding:8px;border:1px solid #e5e7eb"><strong>Alert Type</strong></td><td style="padding:8px;border:1px solid #e5e7eb">${alertType}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb"><strong>Severity</strong></td><td style="padding:8px;border:1px solid #e5e7eb">${severity}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb"><strong>Timestamp</strong></td><td style="padding:8px;border:1px solid #e5e7eb">${timestamp}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb"><strong>Issue Summary</strong></td><td style="padding:8px;border:1px solid #e5e7eb">${summary}</td></tr>
      </table>
    </div>
  `;

  await getTransporter().sendMail({ from, to, subject, text, html });
}

module.exports = { sendAlertEmail };
