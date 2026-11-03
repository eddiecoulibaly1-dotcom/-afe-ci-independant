import type { IncomingMessage } from "node:http";

export interface AuthUser {
  id: string;
  email?: string;
  role?: string;
}

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !publishableKey) return null;
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
