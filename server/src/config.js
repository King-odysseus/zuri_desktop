const DEFAULT_PORT = 8080;

/**
 * Read the small set of configuration values the Railway service needs before
 * database and authentication wiring is added.
 * @param {NodeJS.ProcessEnv} [environment]
 * @returns {{ port: number, nodeEnv: string, databaseUrl: string, googleClientId: string, googleClientSecret: string, googleRedirectUri: string, cloudUrl: string, siteUrl: string, adminEmail: string, adminPassword: string, brevoApiKey: string, mailFrom: string, mailFromName: string, deepSeekApiKey: string, deepSeekEndpoint: string, deepSeekModel: string, paystackSecretKey: string, paystackEndpoint: string, paystackCallbackUrl: string, paystackPlanCodes: Record<string, string>, vapidSubject: string, vapidPublicKey: string, vapidPrivateKey: string, firebaseProjectId: string, firebaseClientEmail: string, firebasePrivateKey: string, windowsClientId: string, windowsClientSecret: string }}
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
  // falls back to CLOUD_URL so local links still open. Railway always injects its
  // public domain, so a deployed server that was never given either still sends a
  // link that opens instead of one pointing at localhost.
  const railwayDomain = typeof environment.RAILWAY_PUBLIC_DOMAIN === 'string' ? environment.RAILWAY_PUBLIC_DOMAIN.trim() : '';
  const siteUrl = (typeof environment.SITE_URL === 'string' ? environment.SITE_URL.trim().replace(/\/$/, '') : '')
    || (railwayDomain === '' ? '' : `https://${railwayDomain}`);

  return {
    port,
    nodeEnv: environment.NODE_ENV === 'production' ? 'production' : 'development',
    databaseUrl: typeof environment.DATABASE_URL === 'string' ? environment.DATABASE_URL.trim() : '',
    googleClientId: typeof environment.GOOGLE_CLIENT_ID === 'string' ? environment.GOOGLE_CLIENT_ID.trim() : '',
    googleClientSecret: typeof environment.GOOGLE_CLIENT_SECRET === 'string' ? environment.GOOGLE_CLIENT_SECRET.trim() : '',
    googleRedirectUri: typeof environment.GOOGLE_REDIRECT_URI === 'string' ? environment.GOOGLE_REDIRECT_URI.trim() : '',
    cloudUrl,
    siteUrl,
    // The first administrator comes from variables, not from SQL: Railway can set
    // these two and the server promotes that account on every boot. The password is
    // kept exactly as given, because trimming would silently change a secret.
    adminEmail: typeof environment.ADMIN_EMAIL === 'string' ? environment.ADMIN_EMAIL.trim() : '',
    adminPassword: typeof environment.ADMIN_PASSWORD === 'string' ? environment.ADMIN_PASSWORD : '',
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
    // Other suppliers behind the Zuri model names. Each speaks the OpenAI chat
    // dialect, so a key is all that is needed to switch one on.
    moonshotApiKey: typeof environment.MOONSHOT_API_KEY === 'string' ? environment.MOONSHOT_API_KEY.trim() : '',
    zaiApiKey: typeof environment.ZAI_API_KEY === 'string' ? environment.ZAI_API_KEY.trim() : '',
    openaiApiKey: typeof environment.OPENAI_API_KEY === 'string' ? environment.OPENAI_API_KEY.trim() : '',
    anthropicApiKey: typeof environment.ANTHROPIC_API_KEY === 'string' ? environment.ANTHROPIC_API_KEY.trim() : '',
    // Supplier prices are in dollars and customers pay in naira, so the admin
    // cost and margin figures need a rate the operator keeps current.
    nairaPerUsd: Number(environment.USD_NGN_RATE) > 0 ? Number(environment.USD_NGN_RATE) : 1600,
    paystackSecretKey: typeof environment.PAYSTACK_SECRET_KEY === 'string' ? environment.PAYSTACK_SECRET_KEY.trim() : '',
    paystackEndpoint: typeof environment.PAYSTACK_ENDPOINT === 'string' && environment.PAYSTACK_ENDPOINT.trim() !== ''
      ? environment.PAYSTACK_ENDPOINT.trim().replace(/\/$/, '')
      : 'https://api.paystack.co',
    paystackCallbackUrl: typeof environment.PAYSTACK_CALLBACK_URL === 'string' ? environment.PAYSTACK_CALLBACK_URL.trim() : '',
    // Attachments. The server only signs an upload; the bytes go from the browser
    // straight to Cloudinary, so a transfer never crosses this process. All three
    // values are needed, and the feature simply reports itself as unavailable when
    // they are absent rather than failing a reply.
    cloudinaryCloudName: typeof environment.CLOUDINARY_CLOUD_NAME === 'string' ? environment.CLOUDINARY_CLOUD_NAME.trim() : '',
    cloudinaryApiKey: typeof environment.CLOUDINARY_API_KEY === 'string' ? environment.CLOUDINARY_API_KEY.trim() : '',
    cloudinaryApiSecret: typeof environment.CLOUDINARY_API_SECRET === 'string' ? environment.CLOUDINARY_API_SECRET.trim() : '',
    // Push credentials are optional. Durable in-app notifications remain the
    // fallback until a deployment has configured each provider it wants to use.
    vapidSubject: typeof environment.VAPID_SUBJECT === 'string' ? environment.VAPID_SUBJECT.trim() : '',
    vapidPublicKey: typeof environment.VAPID_PUBLIC_KEY === 'string' ? environment.VAPID_PUBLIC_KEY.trim() : '',
    vapidPrivateKey: typeof environment.VAPID_PRIVATE_KEY === 'string' ? environment.VAPID_PRIVATE_KEY.trim() : '',
    firebaseProjectId: typeof environment.FIREBASE_PROJECT_ID === 'string' ? environment.FIREBASE_PROJECT_ID.trim() : '',
    firebaseClientEmail: typeof environment.FIREBASE_CLIENT_EMAIL === 'string' ? environment.FIREBASE_CLIENT_EMAIL.trim() : '',
    firebasePrivateKey: typeof environment.FIREBASE_PRIVATE_KEY === 'string' ? environment.FIREBASE_PRIVATE_KEY : '',
    windowsClientId: typeof environment.WINDOWS_PUSH_CLIENT_ID === 'string' ? environment.WINDOWS_PUSH_CLIENT_ID.trim() : '',
    windowsClientSecret: typeof environment.WINDOWS_PUSH_CLIENT_SECRET === 'string' ? environment.WINDOWS_PUSH_CLIENT_SECRET : '',
    paystackPlanCodes: {
      starter: typeof environment.PAYSTACK_PLAN_STARTER === 'string' ? environment.PAYSTACK_PLAN_STARTER.trim() : '',
      pro: typeof environment.PAYSTACK_PLAN_PRO === 'string' ? environment.PAYSTACK_PLAN_PRO.trim() : '',
      power: typeof environment.PAYSTACK_PLAN_POWER === 'string' ? environment.PAYSTACK_PLAN_POWER.trim() : '',
      max: typeof environment.PAYSTACK_PLAN_MAX === 'string' ? environment.PAYSTACK_PLAN_MAX.trim() : '',
    },
  };
}
