import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import type { Provider } from "./types.js";

type JsonSchema = Record<string, unknown>;

export async function callModel<T>(args: {
  provider: Provider;
  model: string;
  system: string;
  prompt: string;
  schemaName: string;
  schema: JsonSchema;
}): Promise<T> {
  if (args.provider === "openai") return callOpenAI<T>(args);
  return callGemini<T>(args);
}

async function callOpenAI<T>(args: Parameters<typeof callModel>[0]): Promise<T> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is missing");
  const client = new OpenAI({ apiKey: key });
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
}

async function callGemini<T>(args: Parameters<typeof callModel>[0]): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is missing");
  const ai = new GoogleGenAI({ apiKey: key });
  const interaction = await ai.interactions.create({
    model: args.model,
    system_instruction: args.system,
    input: args.prompt,
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: args.schema
    }
  });
  if (!interaction.output_text) throw new Error("Gemini returned no output_text");
  return JSON.parse(interaction.output_text) as T;
}
