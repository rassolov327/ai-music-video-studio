const nodemailer = require('nodemailer');

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/**
 * Sends the finished PDF by email. No-ops (and returns sent:false) instead
 * of throwing when SMTP isn't configured, so the rest of the pipeline never
 * depends on this being set up.
 */
async function sendPdfEmail({ to, subject, text, attachmentPath }) {
  if (!smtpConfigured()) {
    return { sent: false, reason: 'SMTP не настроен (SMTP_HOST/SMTP_USER/SMTP_PASS отсутствуют)' };
  }
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    attachments: attachmentPath ? [{ path: attachmentPath }] : [],
  });

  return { sent: true };
}

module.exports = { sendPdfEmail, smtpConfigured };
