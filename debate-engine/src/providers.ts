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

export async function callModel<T>(args: ModelArgs): Promise<T> {
  if (args.provider === "openai") return callOpenAI<T>(args);
  return callGemini<T>(args);
}

async function callOpenAI<T>(args: ModelArgs): Promise<T> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is missing");
  const client = new OpenAI({ apiKey: key });
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

async function geminiGenerate(
  key: string,
  model: string,
  system: string,
  prompt: string,
  schema?: JsonSchema
): Promise<string> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
      ...(schema ? {
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: schema
        }
      } : {
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.error?.status || `HTTP ${response.status}`;
    throw new Error(`${response.status} ${detail}`);
  }
  return extractGeminiText(payload);
}

async function callGemini<T>(args: ModelArgs): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is missing");

  try {
    const text = await geminiGenerate(key, args.model, args.system, args.prompt, args.schema);
    return JSON.parse(text) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Gemini's structured-output validator supports a subset of JSON Schema.
    // If a complex schema is rejected, retry with JSON MIME mode and let the
    // application parse the model output. This preserves the debate engine's
    // own deterministic validation/convergence rules without depending on a
    // brittle provider-side schema feature.
    if (/\b400\b|INVALID_ARGUMENT|schema/i.test(message)) {
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
