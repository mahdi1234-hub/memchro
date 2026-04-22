// Creates the HNSW + secondary indexes on the pgvector table.
// Idempotent — safe to run many times.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("Creating HNSW cosine index on memories.embedding…");
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS memories_embedding_hnsw_cosine_idx
       ON memories USING hnsw (embedding vector_cosine_ops);`
  );
  console.log("Creating (user_id, kind) index on memories…");
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS memories_user_kind_idx
       ON memories (user_id, kind);`
  );
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
