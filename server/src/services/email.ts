import { config } from '../config';
import { verificationHtml, verificationText } from './emailTemplate';

/**
 * Verification e-mails are always sent from the SERVER, so codes are never visible in the browser.
 *
 * Providers (first one configured wins):
 *  1. Brevo  — BREVO_API_KEY + MAIL_FROM (a sender verified in Brevo). Free 300 e-mails/day, plain HTTPS API.
 *  2. EmailJS — EMAILJS_SERVICE_ID/TEMPLATE_ID/PUBLIC_KEY/PRIVATE_KEY. Needs, in the EmailJS dashboard,
 *     Account → Security → ✔ "Allow EmailJS API for non-browser applications".
 *     Template receives: {{to_email}} {{username}} {{code}} {{minutes}} {{site}}.
 */
const brevoOn = () => !!(config.brevo.apiKey && config.brevo.from);
const emailjsOn = () => !!(config.emailjs.serviceId && config.emailjs.templateId && config.emailjs.publicKey && config.emailjs.privateKey);

export const emailConfigured = () => brevoOn() || emailjsOn();
export const emailProvider = () => (brevoOn() ? 'brevo' : emailjsOn() ? 'emailjs' : 'none');

const MINUTES = 15;
const site = () => config.clientUrl.replace(/\/$/, '');

export class EmailError extends Error {}

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
      template_params: { to_email: to, email: to, username, code, minutes: MINUTES, site: site() },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[email] EmailJS error', res.status, text);
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
  if (brevoOn()) return viaBrevo(to, username, code);
  if (emailjsOn()) return viaEmailjs(to, username, code);
  console.warn(`[email] no e-mail provider configured — verification code for ${to}: ${code}`);
}
