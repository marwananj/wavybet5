import { config } from '../config';
import { verificationHtml, verificationText } from './emailTemplate';

/**
 * Verification e-mails are always sent from the SERVER, so codes are never visible in the browser.
 *
 * Providers (first one configured wins):
 *  0. Resend — RESEND_API_KEY + MAIL_FROM on your own verified domain (e.g. no-reply@wavybet.com). Best deliverability.
 *  0b. Mailjet — MAILJET_API_KEY + MAILJET_SECRET_KEY + MAIL_FROM (sender validated in Mailjet). Free 200/day.
 *  1. Brevo  — BREVO_API_KEY + MAIL_FROM (a sender verified in Brevo). Free 300 e-mails/day, plain HTTPS API.
 *  2. EmailJS — EMAILJS_SERVICE_ID/TEMPLATE_ID/PUBLIC_KEY/PRIVATE_KEY. Needs, in the EmailJS dashboard,
 *     Account → Security → ✔ "Allow EmailJS API for non-browser applications".
 *     Template receives: {{to_email}} {{username}} {{code}} {{minutes}} {{site}}.
 */
const resendOn = () => !!(config.resend.apiKey && config.brevo.from);
const mailjetOn = () => !!(config.mailjet.apiKey && config.mailjet.secretKey && config.brevo.from);
const brevoOn = () => !!(config.brevo.apiKey && config.brevo.from);
const emailjsOn = () => !!(config.emailjs.serviceId && config.emailjs.templateId && config.emailjs.publicKey && config.emailjs.privateKey);

export const emailConfigured = () => resendOn() || mailjetOn() || brevoOn() || emailjsOn();
export const emailProvider = () => (resendOn() ? 'resend' : mailjetOn() ? 'mailjet' : brevoOn() ? 'brevo' : emailjsOn() ? 'emailjs' : 'none');

const MINUTES = 15;
const site = () => config.clientUrl.replace(/\/$/, '');

export class EmailError extends Error {}

/** raw answer of the provider's last failure (admin diagnostics) */
export let lastEmailFailure: { at: string; provider: string; status: number; body: string } | null = null;

async function viaResend(to: string, username: string, code: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.resend.apiKey}` },
    body: JSON.stringify({
      from: `${config.brevo.fromName} <${config.brevo.from}>`,
      to: [to],
      subject: `${code} is your WavyBet code 🎁 $25 gift inside`,
      html: verificationHtml(username, code, MINUTES, site()),
      text: verificationText(username, code, MINUTES),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[email] Resend error', res.status, text);
    lastEmailFailure = { at: new Date().toISOString(), provider: 'Resend', status: res.status, body: text.slice(0, 500) };
    throw new EmailError(
      res.status === 401 || (res.status === 403 && /api key/i.test(text))
        ? 'E-mail service key is invalid (RESEND_API_KEY)'
        : /domain/i.test(text)
          ? 'E-mail sender domain is not verified in Resend (MAIL_FROM)'
          : res.status === 429
            ? 'E-mail limit reached — please try again later'
            : 'Could not send the e-mail, please try again'
    );
  }
}

async function viaMailjet(to: string, username: string, code: string) {
  const auth = Buffer.from(`${config.mailjet.apiKey}:${config.mailjet.secretKey}`).toString('base64');
  const res = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify({
      Messages: [
        {
          From: { Email: config.brevo.from, Name: config.brevo.fromName },
          To: [{ Email: to, Name: username }],
          Subject: `${code} is your WavyBet code 🎁 $25 gift inside`,
          TextPart: verificationText(username, code, MINUTES),
          HTMLPart: verificationHtml(username, code, MINUTES, site()),
          CustomID: 'wavybet-verify',
        },
      ],
    }),
  });
  const text = await res.text().catch(() => '');
  // Mailjet can answer 200 with a per-message error, so check the status inside the body too
  let status = '';
  try {
    status = JSON.parse(text)?.Messages?.[0]?.Status ?? '';
  } catch {
    /* ignore */
  }
  if (!res.ok || (status && status !== 'success')) {
    console.error('[email] Mailjet error', res.status, text);
    lastEmailFailure = { at: new Date().toISOString(), provider: 'Mailjet', status: res.status, body: text.slice(0, 500) };
    throw new EmailError(
      res.status === 401
        ? 'E-mail service keys are invalid (MAILJET_API_KEY / MAILJET_SECRET_KEY)'
        : /sender|from/i.test(text)
          ? 'E-mail sender is not validated in Mailjet (MAIL_FROM)'
          : /suspend|blocked|review/i.test(text)
            ? 'E-mail account is under review by Mailjet — try again later'
            : res.status === 429
              ? 'E-mail limit reached — please try again later'
              : 'Could not send the e-mail, please try again'
    );
  }
}

async function viaBrevo(to: string, username: string, code: string) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accept: 'application/json', 'api-key': config.brevo.apiKey },
    body: JSON.stringify({
      sender: { email: config.brevo.from, name: config.brevo.fromName },
      to: [{ email: to, name: username }],
      subject: `${code} is your WavyBet code 🎁 $25 gift inside`,
      htmlContent: verificationHtml(username, code, MINUTES, site()),
      textContent: verificationText(username, code, MINUTES),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[email] Brevo error', res.status, text);
    lastEmailFailure = { at: new Date().toISOString(), provider: 'Brevo', status: res.status, body: text.slice(0, 500) };
    throw new EmailError(
      res.status === 401 ? 'E-mail service key is invalid (BREVO_API_KEY)' : /sender/i.test(text) ? 'E-mail sender is not verified in Brevo (MAIL_FROM)' : 'Could not send the e-mail, please try again'
    );
  }
}

async function viaEmailjs(to: string, username: string, code: string) {
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: config.emailjs.serviceId,
      template_id: config.emailjs.templateId,
      user_id: config.emailjs.publicKey,
      accessToken: config.emailjs.privateKey,
      template_params: {
        to_email: to,
        email: to,
        username,
        code,
        minutes: MINUTES,
        site: site(),
        // aliases so EmailJS's ready-made templates work too ("One-Time Password" uses {{passcode}} + {{time}},
        // "Contact Us" uses {{name}} + {{message}})
        passcode: code,
        otp: code,
        verification_code: code,
        time: new Date(Date.now() + MINUTES * 60_000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC',
        name: username,
        to_name: username,
        title: 'Your WavyBet verification code',
        message: `Your WavyBet verification code is ${code}. It expires in ${MINUTES} minutes.`,
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[email] EmailJS error', res.status, text);
    lastEmailFailure = { at: new Date().toISOString(), provider: 'EmailJS', status: res.status, body: text.slice(0, 500) };
    if (res.status === 403 && /non-browser/i.test(text))
      console.error('[email] FIX: EmailJS dashboard → Account → Security → enable "Allow EmailJS API for non-browser applications", then Save.');
    throw new EmailError(
      res.status === 403
        ? /non-browser/i.test(text)
          ? 'Our e-mail service is being set up — please try again in a few minutes'
          : 'E-mail service rejected the request (check the EmailJS keys)'
        : res.status === 400 && /template|service/i.test(text)
          ? 'E-mail template or service ID is wrong'
          : res.status === 429 || res.status === 426
            ? 'E-mail limit reached — please try again later'
            : 'Could not send the e-mail, please try again'
    );
  }
}

export async function sendVerificationEmail(to: string, username: string, code: string) {
  if (resendOn()) return viaResend(to, username, code);
  if (mailjetOn()) return viaMailjet(to, username, code);
  if (brevoOn()) return viaBrevo(to, username, code);
  if (emailjsOn()) return viaEmailjs(to, username, code);
  console.warn(`[email] no e-mail provider configured — verification code for ${to}: ${code}`);
}
