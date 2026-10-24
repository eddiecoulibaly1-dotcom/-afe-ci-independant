import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
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

async function callGemini<T>(args: ModelArgs): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is missing");
  const ai = new GoogleGenAI({ apiKey: key });

  const baseRequest = {
    model: args.model,
    system_instruction: args.system,
    input: `${args.prompt}\n\nReturn ONLY one valid JSON object matching the requested structure. Do not use markdown fences, commentary, or extra text.`
  } as const;

  try {
    const interaction = await ai.interactions.create({
      ...baseRequest,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: args.schema
      }
    });
    if (!interaction.output_text) throw new Error("Gemini returned no output_text");
    return JSON.parse(interaction.output_text) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Gemini's structured-output schema validator is stricter than JSON Schema
    // and can reject otherwise valid nested schemas with HTTP 400. Retry in
    // JSON mode without a schema; the application remains responsible for
    // parsing and validating the returned object before using it.
    if (/\b400\b|INVALID_ARGUMENT|schema/i.test(message)) {
      try {
        const fallback = await ai.interactions.create({
          ...baseRequest,
          response_format: {
            type: "text",
            mime_type: "application/json"
          }
        });
        if (!fallback.output_text) throw new Error("Gemini returned no output_text");
        return JSON.parse(fallback.output_text) as T;
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(`Gemini ${args.model}: structured output failed (${message}); JSON fallback failed (${fallbackMessage})`);
      }
    }

    throw new Error(`Gemini ${args.model}: ${message}`);
  }
}
