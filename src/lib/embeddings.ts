/**
 * Local embeddings via @xenova/transformers (sentence-transformers/all-MiniLM-L6-v2).
 * Runs inside the Next.js server process — no external API, no key. Produces
 * 384-dim float vectors that we store in pgvector.
 *
 * The first call on a cold container downloads the ONNX model to a cache dir
 * (~25MB). On Vercel we point that cache at `/tmp` which is the only writable
 * location.
 */

// We import dynamically so the heavy onnxruntime-node isn't pulled in at
// module parse time.

declare global {
  // eslint-disable-next-line no-var
  var __memchro_embedder:
    | ((text: string | string[], opts?: { pooling: "mean"; normalize: boolean }) => Promise<{ data: Float32Array }>)
    | undefined;
}

let loading: Promise<void> | null = null;

async function loadEmbedder() {
  if (globalThis.__memchro_embedder) return;
  if (!loading) {
    loading = (async () => {
      const { env: tenv, pipeline } = await import("@xenova/transformers");
      // Force ONNX model cache into /tmp on serverless
      tenv.cacheDir = process.env.XENOVA_CACHE_DIR ?? "/tmp/xenova";
      tenv.allowLocalModels = false;
      const extractor = await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2"
      );
      globalThis.__memchro_embedder = async (text, opts) => {
        const out = await extractor(text, opts);
        return out as unknown as { data: Float32Array };
      };
    })();
  }
  await loading;
}

export const EMBED_DIM = 384;

export async function embed(text: string): Promise<number[]> {
  await loadEmbedder();
  const embedder = globalThis.__memchro_embedder!;
  const out = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

export async function embedMany(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (const t of texts) {
    results.push(await embed(t));
  }
  return results;
}
