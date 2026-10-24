import { createHmac, timingSafeEqual } from 'node:crypto';

/** @param {unknown} value @returns {string} */
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Paystack signs the exact raw request body, not a re-serialized JSON object.
 * Comparing fixed-length buffers avoids accepting a partial signature.
 * @param {string} rawBody
 * @param {string} signature
 * @param {string} secretKey
 */
export function verifyPaystackSignature(rawBody, signature, secretKey) {
  const received = text(signature);
  const secret = text(secretKey);
  if (received === '' || secret === '') return false;
  const expected = createHmac('sha512', secret).update(rawBody, 'utf8').digest('hex');
  const receivedBuffer = Buffer.from(received, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

/** @param {{ secretKey?: string, endpoint?: string, fetchImpl?: typeof fetch }} options */
export function createPaystackClient({ secretKey, endpoint = 'https://api.paystack.co', fetchImpl = fetch } = {}) {
  const key = text(secretKey);
  if (key === '') return null;
  const baseUrl = text(endpoint).replace(/\/$/, '') || 'https://api.paystack.co';

  async function request(path, options = {}) {
    const result = await fetchImpl(`${baseUrl}${path}`, {
      ...options,
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
    const payload = await result.json().catch(() => null);
    if (!result.ok || payload?.status !== true) {
      const error = new Error('Paystack rejected the payment request.');
      error.code = 'PAYSTACK_REQUEST_FAILED';
      error.status = result.status;
      throw error;
    }
    return payload.data;
  }

  return {
    initializeTransaction({ email, amountKobo, reference, planCode, callbackUrl }) {
      const body = { email, amount: String(amountKobo), currency: 'NGN', reference, metadata: JSON.stringify({ product: 'zuri-cloud', planCode }) };
      if (planCode) body.plan = planCode;
      if (callbackUrl) body.callback_url = callbackUrl;
      return request('/transaction/initialize', { method: 'POST', body: JSON.stringify(body) });
    },
    verifyTransaction(reference) {
      return request(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' });
    },
  };
}
