import type { IncomingMessage } from "node:http";

export interface AuthUser {
  id: string;
  email?: string;
  role?: string;
}

function config() {
  const rawUrl = process.env.SUPABASE_URL?.trim();
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!rawUrl || !publishableKey) return null;

  // SUPABASE_URL must be the project base URL, not an Auth/REST endpoint.
  // Normalize accidental suffixes such as /auth/v1 or /rest/v1 so callers
  // can safely append /auth/v1/... without producing an invalid request path.
  let url: string;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    url = parsed.origin;
  } catch {
    return null;
  }

  return { url, publishableKey };
}

export function publicAuthConfig() {
  const cfg = config();
  if (!cfg) return null;
  return { supabaseUrl: cfg.url, url: cfg.url, publishableKey: cfg.publishableKey };
}

export async function authenticateRequest(req: IncomingMessage): Promise<AuthUser | null> {
  const cfg = config();
  const header = req.headers.authorization;
  if (!cfg || typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  const accessToken = header.slice("Bearer ".length).trim();
  if (!accessToken || accessToken.length > 8192) return null;

  try {
    const response = await fetch(`${cfg.url}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: cfg.publishableKey,
        Authorization: `Bearer ${accessToken}`
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return null;
    const user = await response.json() as { id?: string; email?: string; role?: string };
    return user.id ? { id: user.id, email: user.email, role: user.role } : null;
  } catch {
    return null;
  }
}
