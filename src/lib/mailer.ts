import nodemailer from "nodemailer";
import { env } from "./env";

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtpHost(),
      port: env.smtpPort(),
      secure: env.smtpPort() === 465,
      auth: {
        user: env.smtpUser(),
        pass: env.smtpPass(),
      },
    });
  }
  return transporter;
}

export async function sendMagicLinkEmail(params: {
  to: string;
  url: string;
}) {
  const { to, url } = params;
  const brand = "memchro";
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#05060a;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;color:#f5f7ff;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#05060a;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:linear-gradient(160deg,#0b0f1f 0%,#1a0f3d 100%);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:32px;">
            <tr>
              <td>
                <h1 style="margin:0 0 8px 0;font-size:22px;letter-spacing:-0.01em;">Sign in to ${brand}</h1>
                <p style="margin:0 0 24px 0;color:#a6adc8;line-height:1.6;">Click the button below to sign in. This link will expire in 15 minutes and can only be used once.</p>
                <p style="margin:0 0 24px 0;">
                  <a href="${url}" style="display:inline-block;background:#6c5cff;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">
                    Sign in to ${brand}
                  </a>
                </p>
                <p style="margin:0;color:#a6adc8;font-size:12px;line-height:1.6;">Or paste this URL into your browser:<br /><span style="color:#f5f7ff;word-break:break-all;">${url}</span></p>
              </td>
            </tr>
          </table>
          <p style="color:#6b7280;font-size:12px;margin:16px 0 0 0;">If you didn't request this, you can ignore this email.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `Sign in to ${brand}\n\nClick this link to sign in (expires in 15 minutes):\n${url}\n\nIf you didn't request this, ignore this email.`;

  await getTransporter().sendMail({
    from: `${brand} <${env.smtpFrom()}>`,
    to,
    subject: `Sign in to ${brand}`,
    text,
    html,
  });
}
