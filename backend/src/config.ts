export interface AppConfig {
  host: string;
  port: number;
  historyLimit: number;
}

export function loadConfig(): AppConfig {
  return {
    host: process.env.HOST || "0.0.0.0",
    port: parseEnvInt(process.env.PORT, 8080),
    historyLimit: parseEnvInt(process.env.HISTORY_LIMIT, 1000)
  };
}

function parseEnvInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
