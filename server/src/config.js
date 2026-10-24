const DEFAULT_PORT = 8080;

/**
 * Read the small set of configuration values the Railway service needs before
 * database and authentication wiring is added.
 * @param {NodeJS.ProcessEnv} [environment]
 * @returns {{ port: number, nodeEnv: string, databaseUrl: string }}
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
  };
}
