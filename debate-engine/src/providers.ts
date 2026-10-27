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

// Production policy: the debate engine uses one stable OpenAI path.
// Environment model names are deliberately ignored so a stale/mistyped
// OPENAI_MODEL (for example an obsolete gpt-6-luna value) can never break the UI.
const PRIMARY_MODEL = "gpt-4.1-mini";
const FALLBACK_MODEL = "gpt-4o-mini";
const PROVIDER_TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS ?? 20_000);
const FALLBACK_TIMEOUT_MS = Number(process.env.FALLBACK_TIMEOUT_MS ?? 12_000);
const JUDGE_TIMEOUT_MS = Number(process.env.JUDGE_TIMEOUT_MS ?? 18_000);
const JUDGE_FALLBACK_TIMEOUT_MS = Number(process.env.JUDGE_FALLBACK_TIMEOUT_MS ?? 10_000);
const FRENCH_OUTPUT_CONTRACT = `
CONTRAT DE SORTIE OBLIGATOIRE — FRANÇAIS EXCLUSIVEMENT :
- Toutes les valeurs textuelles narratives doivent être rédigées en français naturel et professionnel.
- Aucun texte narratif en anglais, même partiellement.
- Les noms de champs JSON, identifiants, noms de modèles et valeurs d'énumération imposées par le schéma peuvent rester techniques.
- Les termes techniques internationaux réellement nécessaires peuvent rester tels quels, mais la phrase qui les contient doit rester française.
- Reformule en français tout contenu anglais présent dans l’historique ou le contexte au lieu de le recopier.
- Retourne uniquement le JSON demandé par le schéma, sans commentaire ni bloc Markdown.`;

export async function callModel<T>(args: ModelArgs): Promise<T> {
  // Ignore provider/model supplied by deployment configuration. This is the
  // single production boundary for Architect, Red Team and Arbiter.
  const hardenedArgs: ModelArgs = {
    ...args,
    provider: "openai",
    model: PRIMARY_MODEL,
    system: `${args.system}\n\n${FRENCH_OUTPUT_CONTRACT}`,
    prompt: `${args.prompt}\n\n${FRENCH_OUTPUT_CONTRACT}`
  };
  return callOpenAI<T>(hardenedArgs);
}

function isAuthProviderError(message: string): boolean {
  return /\b401\b|incorrect api key|invalid api key|api key not valid|api_key_invalid|invalid authentication|authentication failed|permission.?denied/i.test(message);
}

function isTransientProviderError(message: string): boolean {
  return /\b408\b|\b409\b|\b429\b|\b500\b|\b502\b|\b503\b|\b504\b|timeout|timed out|overloaded|temporar|quota|resource.?exhausted/i.test(message);
}

function providerError(message: string, provider: string, model: string): Error {
  if (isAuthProviderError(message)) {
    return new Error(`${provider.toUpperCase()}_AUTH_ERROR: authentification du modèle ${model} refusée. Vérifie la clé API, son projet et ses permissions dans l'environnement de production.`);
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
    return await callOpenAIRequest<T>(args, PRIMARY_MODEL, primaryTimeout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (isAuthProviderError(message)) throw providerError(message, "OpenAI", PRIMARY_MODEL);

    if (isTransientProviderError(message)) {
      try {
        return await callOpenAIRequest<T>({ ...args, model: FALLBACK_MODEL }, FALLBACK_MODEL, fallbackTimeout);
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        if (isAuthProviderError(fallbackMessage)) throw providerError(fallbackMessage, "OpenAI", FALLBACK_MODEL);
        throw new Error(`OpenAI ${PRIMARY_MODEL} indisponible (${message}); secours ${FALLBACK_MODEL} indisponible (${fallbackMessage})`);
      }
    }
    throw providerError(message, "OpenAI", PRIMARY_MODEL);
  }
}
