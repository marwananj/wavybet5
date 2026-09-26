import { config } from '../config';

/**
 * Transactional e-mail through EmailJS (https://www.emailjs.com) — called from the SERVER with the
 * private key, so verification codes are never generated or visible in the browser.
 * EmailJS dashboard → Account → Security: enable "Allow EmailJS API for non-browser applications".
 * The template receives: {{to_email}} {{username}} {{code}} {{minutes}} {{site}}.
 */
export const emailConfigured = () => !!(config.emailjs.serviceId && config.emailjs.templateId && config.emailjs.publicKey && config.emailjs.privateKey);

export async function sendVerificationEmail(to: string, username: string, code: string) {
  if (!emailConfigured()) {
    console.warn(`[email] EmailJS not configured — verification code for ${to}: ${code}`);
    return;
  }
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
        minutes: 15,
        site: 'WavyBet',
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[email] EmailJS error', res.status, text);
    throw new Error(res.status === 403 ? 'E-mail service is not enabled for server use (EmailJS security setting)' : 'Could not send the e-mail, try again');
  }
}
