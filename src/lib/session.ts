import crypto from "crypto";
import fs from "fs";
import path from "path";

const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours
const COOKIE_NAME = "sofi_session";
const SESSION_FILE = path.join(process.cwd(), ".sessions.json");

function loadSessions(): Map<string, { expiresAt: number }> {
  try {
    const raw = fs.readFileSync(SESSION_FILE, "utf-8");
    const obj = JSON.parse(raw) as Record<string, { expiresAt: number }>;
    const now = Date.now();
    return new Map(Object.entries(obj).filter(([, v]) => v.expiresAt > now));
  } catch {
    return new Map();
  }
}

function saveSessions(store: Map<string, { expiresAt: number }>) {
  try {
    const obj = Object.fromEntries(store);
    fs.writeFileSync(SESSION_FILE, JSON.stringify(obj), "utf-8");
  } catch {}
}

if (!(globalThis as any).__sessionStore) {
  (globalThis as any).__sessionStore = loadSessions();
}
const sessionStore = (globalThis as any).__sessionStore as Map<string, { expiresAt: number }>;

// Clean expired sessions periodically
setInterval(() => {
  const now = Date.now();
  sessionStore.forEach((val, key) => {
    if (now > val.expiresAt) sessionStore.delete(key);
  });
}, 60_000);

export function createSession(): string {
  const token = crypto.randomBytes(32).toString("hex");
  sessionStore.set(token, { expiresAt: Date.now() + SESSION_TTL });
  saveSessions(sessionStore);
  return token;
}

export function validateSession(token: string | undefined | null): boolean {
  if (!token) return false;
  const entry = sessionStore.get(token);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    sessionStore.delete(token);
    return false;
  }
  return true;
}

export function deleteSession(token: string) {
  sessionStore.delete(token);
  saveSessions(sessionStore);
}

export function getSessionCookieName(): string {
  return COOKIE_NAME;
}

export function getSessionTTL(): number {
  return SESSION_TTL;
}

// Extract session token from request cookies
export function getTokenFromRequest(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

// Check if request is authenticated — returns true/false
export function isAuthenticated(req: Request): boolean {
  return validateSession(getTokenFromRequest(req));
}
