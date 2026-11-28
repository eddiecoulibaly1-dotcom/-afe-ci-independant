export type RetryFailureClassification = { retryable: boolean; code: string; reason: string; retryAfterSeconds?: number };

function retryAfterFrom(error: unknown): number | undefined {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const match = message.match(/retry[- ]after\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? Math.max(0, Math.min(3600, Math.ceil(value))) : undefined;
}

export function classifyRetryFailure(error: unknown): RetryFailureClassification {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  const statusMatch = message.match(/(?:supabase|http|status|provider)[^\d]*(\d{3})/i) ?? message.match(/\b(\d{3})\b/);
  const status = statusMatch ? Number(statusMatch[1]) : undefined;
  const retryAfterSeconds = retryAfterFrom(error);
  if (status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500 && status <= 599)) {
    return { retryable: true, code: status === 429 ? "RATE_LIMITED" : status === 408 || status === 425 ? "REQUEST_TIMEOUT" : "REMOTE_SERVER_ERROR", reason: "Transient HTTP/provider failure.", retryAfterSeconds };
  }
  if (/\b(?:econnreset|econnrefused|etimedout|timeout|timed out|aborterror|fetch failed|socket hang up|network error|temporarily unavailable|overloaded|rate limit|resource exhausted)\b/i.test(lower)) {
    return { retryable: true, code: /rate limit|resource exhausted/i.test(lower) ? "RATE_LIMITED" : /timeout|timed out|etimedout|aborterror/i.test(lower) ? "TIMEOUT" : "NETWORK_TRANSIENT", reason: "Network or provider transient failure.", retryAfterSeconds };
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return { retryable: false, code: "REMOTE_CLIENT_ERROR", reason: "Non-retryable client/auth/configuration response." };
  }
  if (/invalid mission|agent ou mission indisponible|configuration incomplete|configuration incomplete|unauthorized|forbidden|not found|validation|invalid request|schema/i.test(lower)) {
    return { retryable: false, code: "WORKER_VALIDATION_OR_CONFIGURATION", reason: "Permanent validation or configuration failure." };
  }
  return { retryable: true, code: "UNCLASSIFIED_TRANSIENT", reason: "Unknown failures receive a bounded retry policy.", retryAfterSeconds };
}

export function computeRetryDelaySeconds(attempt: number, maxDelaySeconds = 900, retryAfterSeconds?: number): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(1, Math.trunc(attempt)) : 1;
  const base = Math.min(maxDelaySeconds, 15 * Math.pow(2, Math.min(10, safeAttempt - 1)));
  const deterministicJitter = Math.floor(base * ((safeAttempt * 37 % 21) / 100));
  const bounded = Math.min(maxDelaySeconds, base + deterministicJitter);
  return Math.max(1, Math.min(maxDelaySeconds, retryAfterSeconds ?? bounded));
}
