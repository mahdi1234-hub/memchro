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
  cerebrasModel: () => optional(process.env.CEREBRAS_MODEL, "gpt-oss-120b"),

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

  // GitHub-backed persistent memory store (no extra service — uses the PAT).
  //   GITHUB_TOKEN        – personal access token with repo scope
  //   GITHUB_DATA_REPO    – "<owner>/<repo>" for the data repo
  //   GITHUB_DATA_BRANCH  – branch (default: main)
  githubToken: () =>
    required(
      "GITHUB_TOKEN",
      process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
    ),
  githubDataRepo: () =>
    required(
      "GITHUB_DATA_REPO",
      process.env.GITHUB_DATA_REPO ?? process.env.GITHUB_MEMORY_REPO
    ),
  githubDataBranch: () => optional(process.env.GITHUB_DATA_BRANCH, "main"),
};

export function safeAppUrl(): string {
  const u = env.appUrl();
  return u.endsWith("/") ? u.slice(0, -1) : u;
}
