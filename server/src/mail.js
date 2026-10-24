const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const MAIL_TIMEOUT_MS = 10_000;
const RESET_SUBJECT = 'Reset your Zuri Cloud password';
const DEFAULT_FROM_NAME = 'Zuri Cloud';

/** @param {unknown} value @returns {string} */
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** @param {string} code @param {string} message @returns {Error} */
function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Plain text only: the reset link has to survive every mail client, and an HTML
 * part would mean escaping a URL for no gain.
 * @param {string} link
 * @returns {string}
 */
export function passwordResetBody(link) {
  return [
    'Hello,',
    '',
    'Someone asked to reset the password for the Zuri Cloud account that uses this address.',
    '',
    `Open this link to choose a new password: ${link}`,
    '',
    'The link works once and expires in 60 minutes.',
    '',
    'If you did not ask for this, you can ignore this email. The password stays as it is.',
    '',
    'Zuri Cloud',
  ].join('\n');
}

/**
 * Send through Brevo's HTTPS API.
 *
 * A plain fetch keeps this service dependency free, the same way the Paystack
 * client does, and avoids running an SMTP pool inside the web process.
 * @param {{ apiKey?: string, from?: string, fromName?: string, endpoint?: string, fetchImpl?: typeof fetch }} [options]
 * @returns {{ configured: boolean, sendPasswordReset: (request: { to?: string, link?: string }) => Promise<{ sent: boolean, id?: string, reason?: string }> }}
 */
export function createMailer({ apiKey = '', from = '', fromName = '', endpoint = BREVO_ENDPOINT, fetchImpl = fetch } = {}) {
  const key = text(apiKey);
  const sender = text(from);
  const configured = key !== '' && sender !== '';
  const senderName = text(fromName) || DEFAULT_FROM_NAME;

  /** @param {{ to: string, subject: string, body: string }} message */
  async function send({ to, subject, body }) {
    const recipient = text(to);
    if (recipient === '') throw failure('INVALID_MAIL_RECIPIENT', 'A recipient address is required.');
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: sender, name: senderName },
        to: [{ email: recipient }],
        subject,
        textContent: body,
      }),
      signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
    });
    if (!response.ok) throw failure('MAIL_SEND_FAILED', 'The email provider did not accept the message.');
    // Brevo answers with the message id; a body that will not parse is not a
    // failed send, so the id is simply left out.
    const payload = await response.json().catch(() => ({}));
    return { sent: true, id: text(payload?.messageId) };
  }

  return {
    configured,
    /**
     * Unconfigured mail answers { sent: false } rather than throwing, so the route
     * can decide on the 503 and a missing key never looks like a bad reset token.
     * @param {{ to?: string, link?: string }} [request]
     */
    async sendPasswordReset({ to, link } = {}) {
      if (!configured) return { sent: false, reason: 'not_configured' };
      return send({ to, subject: RESET_SUBJECT, body: passwordResetBody(text(link)) });
    },
  };
}
