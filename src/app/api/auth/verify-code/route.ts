import { NextRequest, NextResponse } from "next/server";
import { rateLimit, resetRateLimit } from "@/lib/rateLimit";
import { createSession, getSessionCookieName, getSessionTTL } from "@/lib/session";

// Import the shared OTP store
if (!(globalThis as any).__otpStore) {
  (globalThis as any).__otpStore = new Map<string, { code: string; expiresAt: number }>();
}

function getClientIP(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || req.ip
    || "unknown";
}

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);

  // Rate limit: max 5 verify attempts per IP per 10 minutes, block for 30 min
  const limit = rateLimit("verify-code-ip", ip, {
    maxAttempts: 5,
    windowMs: 10 * 60 * 1000,
    blockDurationMs: 30 * 60 * 1000,
  });

  if (!limit.allowed) {
    const mins = Math.ceil(limit.retryAfterMs / 60_000);
    return NextResponse.json(
      { error: `Too many failed attempts. Try again in ${mins} minute${mins > 1 ? "s" : ""}.` },
      { status: 429 }
    );
  }

  const { email, code } = await req.json();

  if (!email || !code) {
    return NextResponse.json({ error: "Please enter the 6-digit code." }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const store = (globalThis as any).__otpStore as Map<string, { code: string; expiresAt: number }>;
  const entry = store.get(normalizedEmail);

  if (!entry) {
    return NextResponse.json({ error: "No code found. Please request a new one." }, { status: 400 });
  }

  if (Date.now() > entry.expiresAt) {
    store.delete(normalizedEmail);
    return NextResponse.json({ error: "Code has expired. Please request a new one." }, { status: 400 });
  }

  if (code.trim() !== entry.code) {
    return NextResponse.json({ error: "Incorrect code. Please try again." }, { status: 400 });
  }

  // Success — clear OTP, reset rate limit, issue session cookie
  store.delete(normalizedEmail);
  resetRateLimit("verify-code-ip", ip);
  resetRateLimit("send-code-ip", ip);

  const token = createSession();
  const res = NextResponse.json({ success: true });
  res.cookies.set(getSessionCookieName(), token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: Math.floor(getSessionTTL() / 1000),
  });
  return res;
}
