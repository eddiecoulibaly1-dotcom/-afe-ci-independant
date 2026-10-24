import type { IncomingMessage } from "node:http";

export interface AuthUser {
  id: string;
  email?: string;
  role?: string;
}

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) return null;
  return { url, secretKey };
}

export function publicAuthConfig() {
  const cfg = config();
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!cfg?.url || !publishableKey) return null;
  // Keep both names for compatibility with the v1.0.6 client and older clients.
  return { supabaseUrl: cfg.url, url: cfg.url, publishableKey };
}

export async function authenticateRequest(req: IncomingMessage): Promise<AuthUser | null> {
  const cfg = config();
  const header = req.headers.authorization;
  if (!cfg || !header?.startsWith("Bearer ")) return null;
  const accessToken = header.slice("Bearer ".length).trim();
  if (!accessToken) return null;

  const response = await fetch(`${cfg.url}/auth/v1/user`, {
    headers: {
      apikey: cfg.secretKey,
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) return null;
  const user = await response.json() as { id?: string; email?: string; role?: string };
  return user.id ? { id: user.id, email: user.email, role: user.role } : null;
}
