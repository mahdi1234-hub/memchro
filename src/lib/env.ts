function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        "Set it in your .env file or Vercel project settings."
    );
  }
  return value;
}

function optional(value: string | undefined, fallback: string): string {
  return value && value.length > 0 ? value : fallback;
}

export const env = {
  cerebrasApiKey: () =>
    required("CEREBRAS_API_KEY", process.env.CEREBRAS_API_KEY),
  cerebrasBaseUrl: () =>
    optional(process.env.CEREBRAS_BASE_URL, "https://api.cerebras.ai/v1"),
  cerebrasModel: () =>
    optional(process.env.CEREBRAS_MODEL, "qwen-3-235b-a22b-instruct-2507"),

  smtpHost: () => optional(process.env.SMTP_HOST, "smtp.gmail.com"),
  smtpPort: () => Number(optional(process.env.SMTP_PORT, "465")),
  smtpUser: () => required("SMTP_USER", process.env.SMTP_USER),
  smtpPass: () => required("SMTP_PASS", process.env.SMTP_PASS),
  smtpFrom: () =>
    optional(process.env.SMTP_FROM, process.env.SMTP_USER ?? "memchro"),

  authSecret: () =>
    required(
      "AUTH_SECRET",
      process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
    ),

  appUrl: () =>
    optional(
      process.env.NEXT_PUBLIC_APP_URL ??
        process.env.APP_URL ??
        (process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : undefined),
      "http://localhost:3000"
    ),

  // Neon Postgres connection string (with pgvector extension enabled).
  databaseUrl: () => required("DATABASE_URL", process.env.DATABASE_URL),
};

export function safeAppUrl(): string {
  const u = env.appUrl();
  return u.endsWith("/") ? u.slice(0, -1) : u;
}
