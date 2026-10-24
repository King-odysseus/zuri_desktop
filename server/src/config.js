const DEFAULT_PORT = 8080;

/**
 * Read the small set of configuration values the Railway service needs before
 * database and authentication wiring is added.
 * @param {NodeJS.ProcessEnv} [environment]
 * @returns {{ port: number, nodeEnv: string, databaseUrl: string, googleClientId: string, googleClientSecret: string, googleRedirectUri: string, cloudUrl: string, siteUrl: string, brevoApiKey: string, mailFrom: string, mailFromName: string, deepSeekApiKey: string, deepSeekEndpoint: string, deepSeekModel: string, paystackSecretKey: string, paystackEndpoint: string, paystackCallbackUrl: string, paystackPlanCodes: Record<string, string> }}
 */
export function readConfig(environment = process.env) {
  const parsedPort = Number(environment.PORT ?? DEFAULT_PORT);
  const port = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65_536
    ? parsedPort
    : DEFAULT_PORT;
  const cloudUrl = typeof environment.CLOUD_URL === 'string' && environment.CLOUD_URL.trim() !== ''
    ? environment.CLOUD_URL.trim().replace(/\/$/, '')
    : 'http://localhost:8080';
  // Reset links have to point at the public site, which is not always the API host,
  // so SITE_URL is separate and stays empty when it is not set; the link builder
  // falls back to CLOUD_URL so local links still open.
  const siteUrl = typeof environment.SITE_URL === 'string' ? environment.SITE_URL.trim().replace(/\/$/, '') : '';

  return {
    port,
    nodeEnv: environment.NODE_ENV === 'production' ? 'production' : 'development',
    databaseUrl: typeof environment.DATABASE_URL === 'string' ? environment.DATABASE_URL.trim() : '',
    googleClientId: typeof environment.GOOGLE_CLIENT_ID === 'string' ? environment.GOOGLE_CLIENT_ID.trim() : '',
    googleClientSecret: typeof environment.GOOGLE_CLIENT_SECRET === 'string' ? environment.GOOGLE_CLIENT_SECRET.trim() : '',
    googleRedirectUri: typeof environment.GOOGLE_REDIRECT_URI === 'string' ? environment.GOOGLE_REDIRECT_URI.trim() : '',
    cloudUrl,
    siteUrl,
    brevoApiKey: typeof environment.BREVO_API_KEY === 'string' ? environment.BREVO_API_KEY.trim() : '',
    mailFrom: typeof environment.MAIL_FROM === 'string' ? environment.MAIL_FROM.trim() : '',
    mailFromName: typeof environment.MAIL_FROM_NAME === 'string' ? environment.MAIL_FROM_NAME.trim() : '',
    deepSeekApiKey: typeof environment.DEEPSEEK_API_KEY === 'string' ? environment.DEEPSEEK_API_KEY.trim() : '',
    deepSeekEndpoint: typeof environment.DEEPSEEK_ENDPOINT === 'string' && environment.DEEPSEEK_ENDPOINT.trim() !== ''
      ? environment.DEEPSEEK_ENDPOINT.trim().replace(/\/$/, '')
      : 'https://api.deepseek.com/chat/completions',
    deepSeekModel: typeof environment.DEEPSEEK_MODEL === 'string' && environment.DEEPSEEK_MODEL.trim() !== ''
      ? environment.DEEPSEEK_MODEL.trim()
      : 'deepseek-chat',
    paystackSecretKey: typeof environment.PAYSTACK_SECRET_KEY === 'string' ? environment.PAYSTACK_SECRET_KEY.trim() : '',
    paystackEndpoint: typeof environment.PAYSTACK_ENDPOINT === 'string' && environment.PAYSTACK_ENDPOINT.trim() !== ''
      ? environment.PAYSTACK_ENDPOINT.trim().replace(/\/$/, '')
      : 'https://api.paystack.co',
    paystackCallbackUrl: typeof environment.PAYSTACK_CALLBACK_URL === 'string' ? environment.PAYSTACK_CALLBACK_URL.trim() : '',
    paystackPlanCodes: {
      starter: typeof environment.PAYSTACK_PLAN_STARTER === 'string' ? environment.PAYSTACK_PLAN_STARTER.trim() : '',
      pro: typeof environment.PAYSTACK_PLAN_PRO === 'string' ? environment.PAYSTACK_PLAN_PRO.trim() : '',
      power: typeof environment.PAYSTACK_PLAN_POWER === 'string' ? environment.PAYSTACK_PLAN_POWER.trim() : '',
    },
  };
}
