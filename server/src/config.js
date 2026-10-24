const DEFAULT_PORT = 8080;

/**
 * Read the small set of configuration values the Railway service needs before
 * database and authentication wiring is added.
 * @param {NodeJS.ProcessEnv} [environment]
 * @returns {{ port: number, nodeEnv: string, databaseUrl: string, googleClientId: string, googleClientSecret: string, googleRedirectUri: string, cloudUrl: string, deepSeekApiKey: string, deepSeekEndpoint: string, deepSeekModel: string }}
 */
export function readConfig(environment = process.env) {
  const parsedPort = Number(environment.PORT ?? DEFAULT_PORT);
  const port = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65_536
    ? parsedPort
    : DEFAULT_PORT;

  return {
    port,
    nodeEnv: environment.NODE_ENV === 'production' ? 'production' : 'development',
    databaseUrl: typeof environment.DATABASE_URL === 'string' ? environment.DATABASE_URL.trim() : '',
    googleClientId: typeof environment.GOOGLE_CLIENT_ID === 'string' ? environment.GOOGLE_CLIENT_ID.trim() : '',
    googleClientSecret: typeof environment.GOOGLE_CLIENT_SECRET === 'string' ? environment.GOOGLE_CLIENT_SECRET.trim() : '',
    googleRedirectUri: typeof environment.GOOGLE_REDIRECT_URI === 'string' ? environment.GOOGLE_REDIRECT_URI.trim() : '',
    cloudUrl: typeof environment.CLOUD_URL === 'string' && environment.CLOUD_URL.trim() !== ''
      ? environment.CLOUD_URL.trim().replace(/\/$/, '')
      : 'http://localhost:8080',
    deepSeekApiKey: typeof environment.DEEPSEEK_API_KEY === 'string' ? environment.DEEPSEEK_API_KEY.trim() : '',
    deepSeekEndpoint: typeof environment.DEEPSEEK_ENDPOINT === 'string' && environment.DEEPSEEK_ENDPOINT.trim() !== ''
      ? environment.DEEPSEEK_ENDPOINT.trim().replace(/\/$/, '')
      : 'https://api.deepseek.com/chat/completions',
    deepSeekModel: typeof environment.DEEPSEEK_MODEL === 'string' && environment.DEEPSEEK_MODEL.trim() !== ''
      ? environment.DEEPSEEK_MODEL.trim()
      : 'deepseek-chat',
  };
}
