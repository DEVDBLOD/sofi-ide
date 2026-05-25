import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import crypto from "crypto";
import { rateLimit } from "@/lib/rateLimit";

const resend = new Resend(process.env.RESEND_API_KEY || "");
const ALLOWED_EMAIL = (process.env.ALLOWED_EMAIL || "").toLowerCase();
const CODE_TTL = 600_000; // 10 minutes

// Shared OTP store via globalThis (survives hot reload in dev)
if (!(globalThis as any).__otpStore) {
  (globalThis as any).__otpStore = new Map<string, { code: string; expiresAt: number }>();
}
const otpStore = (globalThis as any).__otpStore as Map<string, { code: string; expiresAt: number }>;

function getClientIP(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || req.ip
    || "unknown";
}

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);

  // Rate limit: max 5 send-code requests per IP per 15 minutes, block for 30 min
  const limit = rateLimit("send-code-ip", ip, {
    maxAttempts: 5,
    windowMs: 15 * 60 * 1000,
    blockDurationMs: 30 * 60 * 1000,
  });

  if (!limit.allowed) {
    const mins = Math.ceil(limit.retryAfterMs / 60_000);
    return NextResponse.json(
      { error: `Too many requests. Try again in ${mins} minute${mins > 1 ? "s" : ""}.` },
      { status: 429 }
    );
  }

  const { email } = await req.json();

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Please enter your email address." }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (normalizedEmail !== ALLOWED_EMAIL) {
    return NextResponse.json(
      { error: "This email is not authorised to access the IDE." },
      { status: 403 }
    );
  }

  const code = String(crypto.randomInt(100000, 999999));
  otpStore.set(normalizedEmail, {
    code,
    expiresAt: Date.now() + CODE_TTL,
  });

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "RESEND_API_KEY is not set." }, { status: 500 });
  }

  try {
    await resend.emails.send({
      from: "Sofi IDE <onboarding@resend.dev>",
      to: [normalizedEmail],
      subject: "Sofi IDE - your login code",
      html: `
        <div style="font-family:monospace;background:#121212;color:#E0E0E0;padding:32px;max-width:420px;border:1px solid #444">
          <p style="font-size:18px;font-weight:700;margin:0 0 8px">Sofi IDE</p>
          <p style="margin:0 0 20px;color:#aaa">Your login code is:</p>
          <p style="font-size:40px;font-weight:700;letter-spacing:10px;color:#fff;margin:0 0 24px">${code}</p>
          <p style="color:#666;font-size:12px;margin:0">Expires in 10 minutes. Do not share this code.</p>
        </div>
      `,
    });

    return NextResponse.json({ success: true, message: `Code sent to ${normalizedEmail}.` });
  } catch (e: any) {
    return NextResponse.json({ error: `Failed to send email: ${e.message}` }, { status: 500 });
  }
}
