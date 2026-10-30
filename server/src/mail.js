const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const MAIL_TIMEOUT_MS = 10_000;
const RESET_SUBJECT = 'Reset your Zuri Cloud password';
const AUTOMATION_SUBJECT = 'Zuri has something for you';
// A subject carrying the person's own words is the one they recognise in a list of
// mail, so the prompt leads it. Trimmed, because a subject line is not a paragraph.
const AUTOMATION_SUBJECT_MAX = 60;
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
 * What one finished automation says in an email.
 *
 * Plain text for the same reason the reset mail is: a result carries links from a
 * search, and an HTML part would mean escaping every one of them for no gain. The
 * answer goes in as the model wrote it, markdown and all, which reads perfectly well
 * as plain text and is what the person sees on the Automations page too.
 * @param {{ prompt: string, text: string, failure?: string }} run
 * @returns {string}
 */
export function automationResultBody({ prompt, text: answer, failure: why = '' }) {
  const asked = text(prompt);
  const lines = ['Hello,', '', `This is the scheduled run of: ${asked}`, ''];
  if (text(why) !== '') {
    lines.push(`It did not finish this time: ${text(why)}`, '', 'It will try again at its next scheduled time.');
  } else {
    lines.push(text(answer) === '' ? 'It finished but produced no answer this time.' : text(answer));
  }
  lines.push('', 'You set this up in Zuri. Open the Automations page in Zuri to pause or remove it.', '', 'Zuri Cloud');
  return lines.join('\n');
}

/** The subject for one result, led by the person's own words. */
export function automationResultSubject(prompt) {
  const asked = text(prompt);
  if (asked === '') return AUTOMATION_SUBJECT;
  const short = asked.length > AUTOMATION_SUBJECT_MAX ? `${asked.slice(0, AUTOMATION_SUBJECT_MAX - 3)}...` : asked;
  return `Zuri: ${short}`;
}

/**
 * Send through Brevo's HTTPS API.
 *
 * A plain fetch keeps this service dependency free, the same way the Paystack
 * client does, and avoids running an SMTP pool inside the web process.
 * @param {{ apiKey?: string, from?: string, fromName?: string, endpoint?: string, fetchImpl?: typeof fetch }} [options]
 * @returns {{ configured: boolean, sendPasswordReset: Function, sendAutomationResult: Function }}
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
    /**
     * Send what one scheduled automation produced.
     *
     * Answers { sent: false } rather than throwing when mail is not configured, as
     * the reset does: a run that worked must not be recorded as a failure merely
     * because this deployment has no mail key.
     * @param {{ to?: string, prompt?: string, text?: string, failure?: string }} [request]
     */
    async sendAutomationResult({ to, prompt = '', text: answer = '', failure: why = '' } = {}) {
      if (!configured) return { sent: false, reason: 'not_configured' };
      if (text(to) === '') return { sent: false, reason: 'no_recipient' };
      return send({
        to,
        subject: automationResultSubject(prompt),
        body: automationResultBody({ prompt, text: answer, failure: why }),
      });
    },
  };
}
