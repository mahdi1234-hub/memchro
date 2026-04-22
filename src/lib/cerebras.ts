import OpenAI from "openai";
import { env } from "./env";

let client: OpenAI | null = null;

/**
 * Cerebras exposes an OpenAI-compatible API. We drive it through the official
 * `openai` SDK by pointing baseURL at `https://api.cerebras.ai/v1`.
 */
export function getCerebras(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: env.cerebrasApiKey(),
      baseURL: env.cerebrasBaseUrl(),
    });
  }
  return client;
}

export function cerebrasModel(): string {
  return env.cerebrasModel();
}
