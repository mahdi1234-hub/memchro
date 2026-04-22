import { Pool } from "pg";
import { env } from "./env";

declare global {
  // eslint-disable-next-line no-var
  var __memchro_pool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __memchro_schema_ready: Promise<void> | undefined;
}

export function getPool(): Pool {
  if (!globalThis.__memchro_pool) {
    const connectionString = env.postgresUrl();
    const needsSsl =
      /neon|vercel|amazonaws|supabase|render|railway|pooler/i.test(
        connectionString
      ) || /sslmode=require/i.test(connectionString);
    globalThis.__memchro_pool = new Pool({
      connectionString,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
      max: 3,
    });
  }
  return globalThis.__memchro_pool;
}

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memories (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding VECTOR(384) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS memories_user_idx ON memories(user_id);
CREATE INDEX IF NOT EXISTS memories_embedding_idx
  ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_user_time_idx ON messages(user_id, created_at);
`;

export async function ensureSchema(): Promise<void> {
  if (!globalThis.__memchro_schema_ready) {
    globalThis.__memchro_schema_ready = (async () => {
      const pool = getPool();
      try {
        await pool.query(SCHEMA_SQL);
      } catch (err) {
        globalThis.__memchro_schema_ready = undefined;
        throw err;
      }
    })();
  }
  return globalThis.__memchro_schema_ready;
}

export function toPgVector(values: number[]): string {
  return `[${values.map((v) => (Number.isFinite(v) ? v.toString() : "0")).join(",")}]`;
}

export async function upsertUser(params: {
  id: string;
  email: string;
  name?: string | null;
}): Promise<void> {
  await ensureSchema();
  const pool = getPool();
  await pool.query(
    `INSERT INTO app_users (id, email, name)
       VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET name = COALESCE(EXCLUDED.name, app_users.name)`,
    [params.id, params.email.toLowerCase(), params.name ?? null]
  );
}
