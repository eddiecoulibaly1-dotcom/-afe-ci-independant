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

// Le moteur ne doit jamais masquer une panne d'authentification sous un faux
// "timeout". Les erreurs de clé, de permissions, de quota et de disponibilité
// sont distinguées afin que l'interface puisse afficher la vraie cause.
const PROVIDER_TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS ?? 20_000);
const FALLBACK_TIMEOUT_MS = Number(process.env.FALLBACK_TIMEOUT_MS ?? 9_000);
const JUDGE_TIMEOUT_MS = Number(process.env.JUDGE_TIMEOUT_MS ?? 12_000);
const JUDGE_FALLBACK_TIMEOUT_MS = Number(process.env.JUDGE_FALLBACK_TIMEOUT_MS ?? 5_000);
const FALLBACK_MODEL = process.env.OPENAI_FALLBACK_MODEL ?? "gpt-4.1-mini";
const GEMINI_THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL ?? "low";
const FRENCH_OUTPUT_CONTRACT = `
CONTRAT DE SORTIE OBLIGATOIRE — FRANÇAIS EXCLUSIVEMENT :
- Toutes les valeurs textuelles narratives doivent être rédigées en français naturel et professionnel.
- Aucun texte narratif en anglais, même partiellement.
- Les noms de champs JSON, identifiants, noms de modèles et valeurs d'énumération imposées par le schéma peuvent rester techniques.
- Les termes techniques internationaux réellement nécessaires peuvent rester tels quels, mais la phrase qui les contient doit rester française.
- Reformule en français tout contenu anglais présent dans l'historique ou le contexte au lieu de le recopier.
- Retourne uniquement le JSON demandé par le schéma, sans commentaire ni bloc Markdown.`;

export async function callModel<T>(args: ModelArgs): Promise<T> {
  const hardenedArgs = {
    ...args,
    system: `${args.system}\n\n${FRENCH_OUTPUT_CONTRACT}`,
    prompt: `${args.prompt}\n\n${FRENCH_OUTPUT_CONTRACT}`
  };
  if (args.provider === "openai") return callOpenAI<T>(hardenedArgs);
  return callGemini<T>(hardenedArgs);
}

function isAuthProviderError(message: string): boolean {
  return /\b401\b|incorrect api key|invalid api key|authentication|api_key_invalid|invalid authentication|permission.?denied/i.test(message);
}

function isTransientProviderError(message: string): boolean {
  return /\b408\b|\b409\b|\b429\b|\b500\b|\b502\b|\b503\b|\b504\b|timeout|timed out|overloaded|temporar|quota|resource.?exhausted/i.test(message);
}

function providerError(message: string, provider: string, model: string): Error {
  if (isAuthProviderError(message)) {
    return new Error(`${provider.toUpperCase()}_AUTH_ERROR: authentification du modèle ${model} refusée. Vérifie la clé API, son projet OpenAI et ses permissions dans l'environnement de production.`);
  }
  return new Error(`${provider.toUpperCase()}_PROVIDER_ERROR: ${message}`);
}

function requestTimeoutFor(schemaName: string): number {
  return schemaName === "judge_decision" ? JUDGE_TIMEOUT_MS : PROVIDER_TIMEOUT_MS;
}

function fallbackTimeoutFor(schemaName: string): number {
  return schemaName === "judge_decision" ? JUDGE_FALLBACK_TIMEOUT_MS : FALLBACK_TIMEOUT_MS;
}

async function callOpenAIRequest<T>(args: ModelArgs, model: string, timeoutMs: number): Promise<T> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_CONFIG_ERROR: OPENAI_API_KEY est absente de l'environnement serveur");
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
  const primaryTimeout = requestTimeoutFor(args.schemaName);
  const fallbackTimeout = fallbackTimeoutFor(args.schemaName);
  try {
    return await callOpenAIRequest<T>(args, args.model, primaryTimeout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Une erreur d'authentification ne peut pas être réparée par un retry :
    // surtout, ne pas essayer le modèle de secours avec la même clé invalide.
    if (isAuthProviderError(message)) throw providerError(message, "OpenAI", args.model);

    if (args.model !== FALLBACK_MODEL && isTransientProviderError(message)) {
      try {
        return await callOpenAIRequest<T>(args, FALLBACK_MODEL, fallbackTimeout);
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        if (isAuthProviderError(fallbackMessage)) throw providerError(fallbackMessage, "OpenAI", FALLBACK_MODEL);
        throw new Error(`OpenAI ${args.model} failed (${message}); fallback ${FALLBACK_MODEL} failed (${fallbackMessage})`);
      }
    }
    throw providerError(message, "OpenAI", args.model);
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
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    return callOpenAI<T>({ ...args, provider: "openai", model: FALLBACK_MODEL });
  }

  try {
    const text = await geminiGenerate(key, args.model, args.system, args.prompt, args.schema);
    return JSON.parse(text) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (isAuthProviderError(message)) throw providerError(message, "Gemini", args.model);

    // Gemini est optionnel : en cas de quota/indisponibilité, utiliser OpenAI.
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
    throw providerError(message, "Gemini", args.model);
  }
}
