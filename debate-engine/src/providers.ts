import OpenAI from "openai";
import type { Provider } from "./types.js";

type JsonSchema = { [key: string]: unknown };

type ModelArgs = {
  provider: Provider;
  model: string;
  system: string;
  prompt: string;
  schemaName: string;
  schema: JsonSchema;
};

// The debate endpoint has a generous Vercel execution budget, so provider calls
// must be allowed enough time to complete. A short, separate fallback timeout
// prevents a slow primary model from making the whole debate feel stuck.
const PROVIDER_TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS ?? 20_000);
const FALLBACK_TIMEOUT_MS = Number(process.env.FALLBACK_TIMEOUT_MS ?? 9_000);
const FALLBACK_MODEL = process.env.OPENAI_FALLBACK_MODEL ?? "gpt-4.1-mini";
const GEMINI_THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL ?? "low";

export async function callModel<T>(args: ModelArgs): Promise<T> {
  if (args.provider === "openai") return callOpenAI<T>(args);
  return callGemini<T>(args);
}

function isTransientProviderError(message: string): boolean {
  return /\b408\b|\b409\b|\b429\b|\b500\b|\b502\b|\b503\b|\b504\b|timeout|timed out|overloaded|temporar|quota|resource.?exhausted/i.test(message);
}

async function callOpenAIRequest<T>(args: ModelArgs, model: string, timeoutMs: number): Promise<T> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is missing");
  const client = new OpenAI({ apiKey: key, timeout: timeoutMs, maxRetries: 0 });
  const response = await client.responses.create({
    model,
    instructions: args.system,
    input: args.prompt,
    text: {
      format: {
        type: "json_schema",
        name: args.schemaName,
        strict: true,
        schema: args.schema
      }
    }
  });
  return JSON.parse(response.output_text) as T;
}

async function callOpenAI<T>(args: ModelArgs): Promise<T> {
  try {
    return await callOpenAIRequest<T>(args, args.model, PROVIDER_TIMEOUT_MS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Never retry the same model with the same timeout. The previous production
    // configuration did exactly that and could fail twice for the same reason.
    if (args.model !== FALLBACK_MODEL && isTransientProviderError(message)) {
      try {
        return await callOpenAIRequest<T>(args, FALLBACK_MODEL, FALLBACK_TIMEOUT_MS);
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(`OpenAI ${args.model} failed (${message}); fallback ${FALLBACK_MODEL} failed (${fallbackMessage})`);
      }
    }
    throw new Error(`OpenAI ${args.model}: ${message}`);
  }
}

function extractGeminiText(payload: any): string {
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part: any) => part?.text ?? "")
    .join("")
    .trim();
  if (!text) {
    const blockReason = payload?.promptFeedback?.blockReason;
    const finishReason = payload?.candidates?.[0]?.finishReason;
    throw new Error(`Gemini returned no text${blockReason ? `; blockReason=${blockReason}` : ""}${finishReason ? `; finishReason=${finishReason}` : ""}`);
  }
  return text;
}

async function geminiGenerate(
  key: string,
  model: string,
  system: string,
  prompt: string,
  schema?: JsonSchema
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key
      },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{
          role: "user",
          parts: [{ text: `${prompt}\n\nReturn ONLY one valid JSON object matching the requested structure. Do not use markdown fences, commentary, or extra text.` }]
        }],
        generationConfig: {
          thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL },
          ...(schema ? {
            responseMimeType: "application/json",
            responseJsonSchema: schema
          } : { responseMimeType: "application/json" })
        }
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = payload?.error?.message || payload?.error?.status || `HTTP ${response.status}`;
      throw new Error(`${response.status} ${detail}`);
    }
    return extractGeminiText(payload);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Gemini request timed out after ${PROVIDER_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callGemini<T>(args: ModelArgs): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return callOpenAI<T>({ ...args, provider: "openai", model: FALLBACK_MODEL });
  }

  try {
    const text = await geminiGenerate(key, args.model, args.system, args.prompt, args.schema);
    return JSON.parse(text) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Gemini is never allowed to block a debate. On quota/availability errors,
    // immediately use the independent OpenAI fallback.
    if (isTransientProviderError(message)) {
      try {
        return await callOpenAI<T>({ ...args, provider: "openai", model: FALLBACK_MODEL });
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(`Gemini ${args.model} unavailable (${message}); OpenAI fallback ${FALLBACK_MODEL} failed (${fallbackMessage})`);
      }
    }

    if (/\b400\b|INVALID_ARGUMENT|schema/i.test(message) && !/API key not valid|API_KEY_INVALID|\b401\b|\b403\b/i.test(message)) {
      try {
        const text = await geminiGenerate(key, args.model, args.system, args.prompt);
        return JSON.parse(text) as T;
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(`Gemini ${args.model}: structured JSON failed (${message}); plain JSON retry failed (${fallbackMessage})`);
      }
    }
    throw new Error(`Gemini ${args.model}: ${message}`);
  }
}
