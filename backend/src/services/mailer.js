/**
 * Envío de correos. SMTP desde variables de entorno (SMTP_HOST, SMTP_PORT,
 * SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM).
 * Sin SMTP_HOST (o en pruebas) los correos se guardan en memoria y se
 * imprimen en consola: útil en desarrollo.
 */
const nodemailer = require('nodemailer');
const env = require('../config/env');

const outbox = []; // solo dev/test

const transporter = env.SMTP_HOST && env.NODE_ENV !== 'test'
  ? nodemailer.createTransport({
    host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  })
  : nodemailer.createTransport({ jsonTransport: true });

const T = {
  es: {
    verify_email: { subject: 'Verifica tu correo · {dojo}', title: 'Confirma tu correo', body: 'Hola {name}, confirma tu correo para activar tu cuenta en {dojo}.', button: 'Verificar correo', note: 'El enlace vence en 24 horas.' },
    password_reset: { subject: 'Restablece tu contraseña · {dojo}', title: 'Restablecer contraseña', body: 'Hola {name}, recibimos una solicitud para cambiar tu contraseña.', button: 'Crear nueva contraseña', note: 'El enlace vence en 1 hora. Si no fuiste tú, ignora este correo.' },
    account_access: { subject: 'Tu acceso a {dojo}', title: 'Bienvenido a {dojo}', body: 'Hola {name}, ya tienes cuenta en {dojo}. Crea tu contraseña para entrar a la app y ver tus clases, pagos y grados.', button: 'Crear mi contraseña', note: 'El enlace vence en 7 días.' },
    password_changed: { subject: 'Tu contraseña cambió · {dojo}', title: 'Contraseña actualizada', body: 'Hola {name}, tu contraseña se cambió correctamente. Si no fuiste tú, contacta a tu dojo de inmediato.', button: 'Iniciar sesión', note: '' },
    notification: { subject: '{title} · {dojo}', title: '{title}', body: '{body}', button: 'Abrir BudoDesk', note: '' },
    footer: 'Correo automático de BudoDesk. No respondas a este mensaje.',
  },
  en: {
    verify_email: { subject: 'Verify your email · {dojo}', title: 'Confirm your email', body: 'Hi {name}, please confirm your email to activate your account at {dojo}.', button: 'Verify email', note: 'This link expires in 24 hours.' },
    password_reset: { subject: 'Reset your password · {dojo}', title: 'Reset password', body: 'Hi {name}, we received a request to change your password.', button: 'Choose a new password', note: "This link expires in 1 hour. If it wasn't you, ignore this email." },
    account_access: { subject: 'Your access to {dojo}', title: 'Welcome to {dojo}', body: 'Hi {name}, you now have an account at {dojo}. Create your password to see your classes, payments and ranks.', button: 'Create my password', note: 'This link expires in 7 days.' },
    password_changed: { subject: 'Your password changed · {dojo}', title: 'Password updated', body: "Hi {name}, your password was changed. If it wasn't you, contact your dojo right away.", button: 'Sign in', note: '' },
    notification: { subject: '{title} · {dojo}', title: '{title}', body: '{body}', button: 'Open BudoDesk', note: '' },
    footer: 'Automated email from BudoDesk. Please do not reply.',
  },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => esc(vars[k] ?? ''));

function render(template, lang, vars) {
  const L = T[lang] || T.es;
  const t = L[template];
  const color = /^#[0-9a-f]{6}$/i.test(vars.color || '') ? vars.color : '#B91C1C';
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden">
    <tr><td style="background:${color};color:#fff;padding:20px 28px;font-size:18px;font-weight:bold">${esc(vars.dojo)}</td></tr>
    <tr><td style="padding:28px">
      <h1 style="margin:0 0 12px;font-size:22px;color:#111">${fill(t.title, vars)}</h1>
      <p style="font-size:15px;line-height:1.5;color:#333">${fill(t.body, vars)}</p>
      ${vars.url ? `<p style="margin:24px 0"><a href="${esc(vars.url)}" style="background:${color};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;display:inline-block">${fill(t.button, vars)}</a></p>
      <p style="font-size:12px;color:#666;word-break:break-all">${esc(vars.url)}</p>` : ''}
      ${t.note ? `<p style="font-size:13px;color:#666">${fill(t.note, vars)}</p>` : ''}
    </td></tr>
    <tr><td style="padding:16px 28px;background:#fafafa;font-size:12px;color:#888">${L.footer}</td></tr>
  </table></td></tr></table></body></html>`;
  return { subject: fill(t.subject, vars).replace(/&amp;/g, '&'), html };
}

/**
 * sendMail('password_reset', { to, lang, vars: { name, dojo, url, color } })
 * Nunca lanza: un fallo de correo no debe tumbar la operación principal.
 */
async function sendMail(template, { to, lang = 'es', vars }) {
  if (!to) return { skipped: true };
  try {
    const { subject, html } = render(template, lang, vars);
    const info = await transporter.sendMail({ from: env.MAIL_FROM, to, subject, html });
    if (!env.SMTP_HOST || env.NODE_ENV === 'test') {
      outbox.push({ template, to, subject, vars });
      if (env.NODE_ENV === 'development') console.log(`[mail:${template}] → ${to} ${vars.url || ''}`);
    }
    return { sent: true, id: info.messageId };
  } catch (err) {
    console.error(`[mail:${template}] error enviando a ${to}:`, err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = { sendMail, outbox };
