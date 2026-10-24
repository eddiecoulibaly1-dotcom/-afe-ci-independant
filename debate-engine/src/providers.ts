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

// A debate is a synchronous multi-agent workflow. Keep every model call bounded so
// three rounds can finish comfortably inside Vercel's HTTP execution window.
const PROVIDER_TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS ?? 22_000);
const GEMINI_THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL ?? "low";

export async function callModel<T>(args: ModelArgs): Promise<T> {
  if (args.provider === "openai") return callOpenAI<T>(args);
  return callGemini<T>(args);
}

async function callOpenAI<T>(args: ModelArgs): Promise<T> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is missing");
  // Do not let the SDK silently retry: the engine owns the debate time budget.
  const client = new OpenAI({ apiKey: key, timeout: PROVIDER_TIMEOUT_MS, maxRetries: 0 });
  try {
    const response = await client.responses.create({
      model: args.model,
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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

function isTransientProviderError(message: string): boolean {
  return /\b408\b|\b409\b|\b429\b|\b500\b|\b502\b|\b503\b|\b504\b|timeout|timed out|overloaded|temporar/i.test(message);
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
        systemInstruction: {
          parts: [{ text: system }]
        },
        contents: [{
          role: "user",
          parts: [{
            text: `${prompt}\n\nReturn ONLY one valid JSON object matching the requested structure. Do not use markdown fences, commentary, or extra text.`
          }]
        }],
        generationConfig: {
          thinkingConfig: {
            thinkingLevel: GEMINI_THINKING_LEVEL
          },
          ...(schema ? {
            responseMimeType: "application/json",
            responseJsonSchema: schema
          } : {
            responseMimeType: "application/json"
          })
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
  if (!key) throw new Error("GEMINI_API_KEY is missing");

  try {
    const text = await geminiGenerate(key, args.model, args.system, args.prompt, args.schema);
    return JSON.parse(text) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Schema incompatibility gets one fast plain-JSON fallback. Do not retry transient
    // failures here because doing so would multiply the total debate duration.
    if (/\b400\b|INVALID_ARGUMENT|schema/i.test(message) && !/API key not valid|API_KEY_INVALID|\b401\b|\b403\b/i.test(message)) {
      try {
        const text = await geminiGenerate(key, args.model, args.system, args.prompt);
        return JSON.parse(text) as T;
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(`Gemini ${args.model}: structured JSON failed (${message}); plain JSON retry failed (${fallbackMessage})`);
      }
    }
    if (isTransientProviderError(message)) throw new Error(`Gemini ${args.model}: transient provider failure: ${message}`);
    throw new Error(`Gemini ${args.model}: ${message}`);
  }
}
