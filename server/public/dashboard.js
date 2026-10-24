// All server text is written with textContent, never innerHTML, so account data cannot inject markup.
const TOKEN_KEY = 'zuri-cloud-token';
const $ = (id) => document.getElementById(id);
const tokens = new Intl.NumberFormat();

function notice(message) {
  $('notice').textContent = message;
}

async function api(path, options = {}) {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    const error = new Error(body?.error?.message ?? 'The request failed.');
    error.status = response.status;
    throw error;
  }
  return body.data;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function showSignedOut() {
  $('signed-in').hidden = true;
  $('sign-out').hidden = true;
  $('signed-out').hidden = false;
}

async function startCheckout(planCode, button) {
  button.disabled = true;
  try {
    const result = await api('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ planCode }) });
    window.location.assign(result.authorizationUrl);
  } catch (error) {
    notice(error.message);
    button.disabled = false;
  }
}

async function loadDashboard() {
  const [me, plans, billing] = await Promise.all([api('/api/me'), api('/api/plans'), api('/api/me/billing')]);
  const usage = await api('/api/me/usage');
  const currentPlan = me.subscription?.planCode ?? usage.planCode;

  $('user-name').textContent = me.user?.displayName || me.user?.email || '';
  $('user-email').textContent = me.user?.email ?? '';
  $('usage-text').textContent = `${tokens.format(usage.usedTokens)} of ${tokens.format(usage.monthlyTokens)} tokens used (${usage.percentUsed}%)`;
  $('usage-bar').style.width = `${Math.min(100, usage.percentUsed)}%`;

  const planBox = $('plans');
  planBox.replaceChildren();
  for (const plan of plans) {
    const card = element('div', '', 'plan');
    card.append(element('strong', plan.name));
    card.append(element('p', `${tokens.format(plan.monthlyTokens)} tokens / month`, 'muted'));
    card.append(element('p', plan.amountKobo === 0 ? 'Free' : `NGN ${tokens.format(plan.amountKobo / 100)}`));
    if (plan.code === currentPlan) card.append(element('p', 'Current plan', 'muted'));
    else if (plan.code !== 'free') {
      const button = element('button', 'Choose plan', 'primary');
      button.addEventListener('click', () => void startCheckout(plan.code, button));
      card.append(button);
    }
    planBox.append(card);
  }

  const paymentBox = $('payments');
  paymentBox.replaceChildren();
  if (billing.payments.length === 0) paymentBox.append(element('p', 'No payments yet.', 'muted'));
  for (const payment of billing.payments) {
    const row = element('div', '', 'row');
    row.append(element('span', `${payment.plan_code} - ${payment.reference}`));
    row.append(element('span', `${payment.status} - ${new Date(payment.paid_at || payment.created_at).toLocaleDateString()}`, 'muted'));
    paymentBox.append(row);
  }

  $('signed-out').hidden = true;
  $('signed-in').hidden = false;
  $('sign-out').hidden = false;
}

function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Google sign-in could not be loaded.'));
    document.head.append(script);
  });
}

async function setupGoogle() {
  const config = await api('/api/public-config');
  if (!config.googleClientId) {
    $('google-missing').hidden = false;
    return;
  }
  await loadGoogleScript();
  window.google.accounts.id.initialize({
    client_id: config.googleClientId,
    callback: async (response) => {
      try {
        const result = await api('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential: response.credential }) });
        sessionStorage.setItem(TOKEN_KEY, result.token);
        notice('');
        await loadDashboard();
      } catch (error) {
        notice(error.message);
      }
    },
  });
  window.google.accounts.id.renderButton($('google-button'), { theme: 'outline', size: 'large', text: 'continue_with' });
}

$('sign-out').addEventListener('click', async () => {
  await api('/api/auth/sign-out', { method: 'POST' }).catch(() => {});
  sessionStorage.removeItem(TOKEN_KEY);
  showSignedOut();
});

(async () => {
  const returning = new URLSearchParams(window.location.search).get('reference');
  if (returning) {
    notice('Confirming your payment...');
    await api(`/api/billing/verify?reference=${encodeURIComponent(returning)}`).then(() => notice('Payment confirmed.'), (error) => notice(error.message));
    window.history.replaceState({}, '', window.location.pathname);
  }
  if (sessionStorage.getItem(TOKEN_KEY)) {
    try {
      await loadDashboard();
      return;
    } catch (error) {
      if (error.status !== 401) notice(error.message);
      sessionStorage.removeItem(TOKEN_KEY);
    }
  }
  showSignedOut();
  await setupGoogle().catch((error) => notice(error.message));
})();
