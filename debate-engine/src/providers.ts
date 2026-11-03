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

const PROVIDER_TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS ?? 30_000);
const FALLBACK_TIMEOUT_MS = Number(process.env.FALLBACK_TIMEOUT_MS ?? 25_000);
const JUDGE_TIMEOUT_MS = Number(process.env.JUDGE_TIMEOUT_MS ?? 30_000);
const JUDGE_FALLBACK_TIMEOUT_MS = Number(process.env.JUDGE_FALLBACK_TIMEOUT_MS ?? 25_000);
const FRENCH_OUTPUT_CONTRACT = `
CONTRAT DE SORTIE OBLIGATOIRE — FRANÇAIS EXCLUSIVEMENT :
- Toutes les valeurs textuelles narratives doivent être rédigées en français naturel et professionnel.
- Aucun texte narratif en anglais, même partiellement.
- Les noms de champs JSON, identifiants, noms de modèles et valeurs d'énumération imposées par le schéma peuvent rester techniques.
- Reformule en français tout contenu anglais présent dans l’historique ou le contexte au lieu de le recopier.
- Retourne uniquement le JSON demandé par le schéma, sans commentaire ni bloc Markdown.`;

function isAuthProviderError(message: string): boolean {
  return /\b401\b|\b403\b|incorrect api key|invalid api key|api key not valid|api_key_invalid|invalid authentication|authentication failed|permission.?denied|unauthorized/i.test(message);
}
function isTransientProviderError(message: string): boolean {
  return /\b408\b|\b409\b|\b429\b|\b500\b|\b502\b|\b503\b|\b504\b|timeout|timed out|overloaded|temporar|quota|resource.?exhausted/i.test(message);
}
function requestTimeoutFor(schemaName: string): number {
  return schemaName === "judge_decision" ? JUDGE_TIMEOUT_MS : PROVIDER_TIMEOUT_MS;
}
function fallbackTimeoutFor(schemaName: string): number {
  return schemaName === "judge_decision" ? JUDGE_FALLBACK_TIMEOUT_MS : FALLBACK_TIMEOUT_MS;
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function modelFor(provider: Provider, requested: string): string {
  if (requested && !(provider === "gemini" && /^gpt-/i.test(requested)) && !(provider === "openai" && /^gemini-/i.test(requested))) return requested;
  return provider === "gemini"
    ? (process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash")
    : (process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini");
}
function googleSchema(value: any): any {
  if (Array.isArray(value)) return value.map(googleSchema);
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value.anyOf)) {
    const nonNull = value.anyOf.find((v: any) => v?.type !== "null");
    return { ...googleSchema(nonNull ?? value.anyOf[0]), nullable: value.anyOf.some((v: any) => v?.type === "null") };
  }
  const out: Record<string, any> = {};
  for (const [key, item] of Object.entries(value)) {
    if (["additionalProperties", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"].includes(key)) continue;
    if (key === "type" && typeof item === "string") out.type = item.toUpperCase();
    else out[key] = googleSchema(item);
  }
  return out;
}
async function callOpenAI<T>(args: ModelArgs, model: string, timeoutMs: number): Promise<T> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_CONFIG_ERROR: OPENAI_API_KEY est absente de l'environnement serveur.");
  const client = new OpenAI({ apiKey: key, timeout: timeoutMs, maxRetries: 0 });
  const response = await client.responses.create({
    model,
    instructions: args.system,
    input: args.prompt,
    text: { format: { type: "json_schema", name: args.schemaName, strict: true, schema: args.schema } }
  });
  if (!response.output_text) throw new Error("OPENAI_EMPTY_RESPONSE: le modèle n'a retourné aucun contenu.");
  return JSON.parse(response.output_text) as T;
}
async function callGemini<T>(args: ModelArgs, model: string, timeoutMs: number): Promise<T> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_CONFIG_ERROR: GEMINI_API_KEY est absente de l'environnement serveur.");
  const effectiveTimeout = Number.isFinite(timeoutMs) ? Math.min(60_000, Math.max(10_000, timeoutMs)) : 30_000;
  const client = new GoogleGenAI({ apiKey: key, httpOptions: { timeout: effectiveTimeout } });
  try {
    const response = await client.models.generateContent({
      model,
      contents: args.prompt,
      config: {
        systemInstruction: args.system,
        responseMimeType: "application/json",
        responseSchema: googleSchema(args.schema),
        temperature: 0.2
      }
    });
    const output = response.text?.trim();
    if (!output) throw new Error("GEMINI_EMPTY_RESPONSE: le modèle n'a retourné aucun contenu.");
    return JSON.parse(output) as T;
  } catch (error) {
    throw error;
  }
}
async function callProvider<T>(args: ModelArgs, provider: Provider, model: string, timeoutMs: number): Promise<T> {
  return provider === "openai"
    ? callOpenAI<T>(args, model, timeoutMs)
    : callGemini<T>(args, model, timeoutMs);
}

/**
 * Execute the configured agent provider first. If it fails (including invalid
 * credentials), try the other configured provider once. Never fabricate an
 * agent result: if both providers fail, propagate a diagnostic error.
 */
export async function callModel<T>(args: ModelArgs): Promise<T> {
  const primaryProvider = args.provider;
  const fallbackProvider: Provider = primaryProvider === "openai" ? "gemini" : "openai";
  const primaryModel = modelFor(primaryProvider, args.model);
  const fallbackModel = modelFor(fallbackProvider, "");
  const system = `${args.system}\n\n${FRENCH_OUTPUT_CONTRACT}`;
  const prompt = `${args.prompt}\n\n${FRENCH_OUTPUT_CONTRACT}`;
  const prepared = { ...args, system, prompt };
  try {
    return await callProvider<T>(prepared, primaryProvider, primaryModel, requestTimeoutFor(args.schemaName));
  } catch (primaryError) {
    const primaryMessage = errorText(primaryError);
    let sameProviderMessage = "non tenté";
    if (isTransientProviderError(primaryMessage)) {
      const sameProviderFallback = primaryProvider === "gemini"
        ? (process.env.GEMINI_FALLBACK_MODEL?.trim() || "gemini-3.7-flash")
        : (process.env.OPENAI_FALLBACK_MODEL?.trim() || "gpt-4.1-mini");
      try {
        return await callProvider<T>(prepared, primaryProvider, sameProviderFallback, fallbackTimeoutFor(args.schemaName));
      } catch (sameProviderError) {
        sameProviderMessage = errorText(sameProviderError);
      }
    }
    let fallbackMessage = "";
    try {
      return await callProvider<T>(prepared, fallbackProvider, fallbackModel, fallbackTimeoutFor(args.schemaName));
    } catch (fallbackError) {
      fallbackMessage = errorText(fallbackError);
      // A temporary outage of the secondary provider must not immediately
      // terminate the debate when an explicitly configured alternate model exists.
      if (isTransientProviderError(fallbackMessage)) {
        const alternateModel = fallbackProvider === "gemini"
          ? (process.env.GEMINI_FALLBACK_MODEL?.trim() || "gemini-3.7-flash")
          : (process.env.OPENAI_FALLBACK_MODEL?.trim() || "gpt-4.1-mini");
        if (alternateModel !== fallbackModel) {
          try {
            return await callProvider<T>(prepared, fallbackProvider, alternateModel, fallbackTimeoutFor(args.schemaName));
          } catch (alternateError) {
            fallbackMessage += `; modèle alternatif ${fallbackProvider}/${alternateModel} (${errorText(alternateError)})`;
          }
        }
      }
      throw new Error(
        `DEBATE_PROVIDER_CHAIN_FAILED: agent=${args.schemaName}; primaire=${primaryProvider}/${primaryModel} (${primaryMessage}); secours_meme_fournisseur=${sameProviderMessage}; secours=${fallbackProvider}/${fallbackModel} (${fallbackMessage})`
      );
    }
  }
}
