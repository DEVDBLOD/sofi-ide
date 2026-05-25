"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useIDEStore } from "@/store/useIDEStore";
import { Loader2, ArrowLeft } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { isAuthenticated, setAuthenticated } = useIDEStore();

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  if (isAuthenticated) {
    router.push("/");
    return null;
  }

  async function handleSendCode() {
    setError(""); setSuccess("");
    if (!email.trim()) { setError("Please enter your email address."); return; }
    setIsSending(true);
    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setStep("code"); setSuccess(data.message || `Code sent to ${email.trim()}.`); }
    } catch (e: any) { setError(`Failed to send: ${e.message}`); }
    finally { setIsSending(false); }
  }

  async function handleVerifyCode() {
    setError("");
    if (!code.trim()) { setError("Please enter the 6-digit code."); return; }
    setIsVerifying(true);
    try {
      const res = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        if (data.error.includes("expired")) { setStep("email"); setCode(""); }
      } else { setAuthenticated(true); router.push("/"); }
    } catch (e: any) { setError(`Failed to verify: ${e.message}`); }
    finally { setIsVerifying(false); }
  }

  return (
    <div className="w-screen h-screen flex items-center justify-center relative overflow-hidden" style={{ background: "#0a0a0a" }}>
      {/* Aurora overlay */}
      <div className="aurora pointer-events-none"><div className="lamp" /><div className="lamp lamp-2" /><div className="grain" /></div>

      <div
        className="w-[520px] max-w-[92vw] px-12 py-14 animate-scale-in relative z-10"
        style={{
          background: "rgba(10,10,10,0.85)",
          border: "1px solid rgba(245,245,245,0.08)",
          backdropFilter: "blur(12px)",
        }}
      >
        {/* Eyebrow */}
        <div className="flex items-center gap-2 mb-6">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#ffffff", boxShadow: "0 0 8px rgba(255,255,255,0.6)" }} />
          <span className="font-mono text-[10px] uppercase tracking-[0.32em]" style={{ color: "rgba(245,245,245,0.5)", fontWeight: 600 }}>
            Workspace · Sign in
          </span>
        </div>

        {/* Title */}
        <h1
          className="font-serif select-none mb-2"
          style={{ color: "#ffffff", fontWeight: 900, fontSize: 56, lineHeight: 0.95, letterSpacing: "-0.035em" }}
        >
          Sofi.
        </h1>
        <p
          className="font-serif italic mb-10"
          style={{ color: "rgba(245,245,245,0.5)", fontWeight: 300, fontSize: 16, lineHeight: 1.45 }}
        >
          {step === "email"
            ? "Enter your email and we’ll send you a code."
            : `A 6-digit code was sent to ${email}.`}
        </p>

        {step === "email" ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: "rgba(245,245,245,0.5)" }}>
                Email
              </label>
              <input
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleSendCode()}
                placeholder="you@example.com"
                type="email"
                autoFocus
                className="w-full bg-transparent font-serif italic outline-none transition-colors pb-2"
                style={{
                  color: "#ffffff",
                  fontSize: 20,
                  borderBottom: "1px solid rgba(245,245,245,0.2)",
                }}
              />
            </div>

            {error && (
              <div
                className="font-mono text-[10.5px] uppercase tracking-[0.18em] px-3 py-2"
                style={{
                  color: "#d45f6a",
                  background: "rgba(212,95,106,0.08)",
                  borderLeft: "2px solid #d45f6a",
                }}
              >
                {error}
              </div>
            )}

            <button
              onClick={handleSendCode}
              disabled={isSending}
              className="w-full h-11 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors font-mono uppercase tracking-[0.18em]"
              style={{ background: "#ffffff", color: "#0a0a0a", fontSize: 12, fontWeight: 700 }}
            >
              {isSending ? (
                <><Loader2 size={14} className="animate-spin-custom" /> Sending</>
              ) : (
                <>Send code →</>
              )}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {success && (
              <div
                className="font-mono text-[10.5px] uppercase tracking-[0.18em] px-3 py-2"
                style={{ color: "#ffffff", background: "rgba(255,255,255,0.05)", borderLeft: "2px solid #ffffff" }}
              >
                {success}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: "rgba(245,245,245,0.5)" }}>
                Verification code
              </label>
              <input
                value={code}
                onChange={(e) => { setCode(e.target.value); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleVerifyCode()}
                placeholder="000000"
                maxLength={6}
                autoFocus
                className="w-full bg-transparent font-mono text-center outline-none pb-3"
                style={{
                  color: "#ffffff",
                  fontSize: 36,
                  letterSpacing: "0.45em",
                  paddingLeft: "0.45em",
                  borderBottom: "1px solid rgba(245,245,245,0.2)",
                  fontWeight: 500,
                }}
              />
            </div>

            {error && (
              <div
                className="font-mono text-[10.5px] uppercase tracking-[0.18em] px-3 py-2"
                style={{ color: "#d45f6a", background: "rgba(212,95,106,0.08)", borderLeft: "2px solid #d45f6a" }}
              >
                {error}
              </div>
            )}

            <button
              onClick={handleVerifyCode}
              disabled={isVerifying}
              className="w-full h-11 disabled:opacity-50 flex items-center justify-center gap-2 font-mono uppercase tracking-[0.18em]"
              style={{ background: "#ffffff", color: "#0a0a0a", fontSize: 12, fontWeight: 700 }}
            >
              {isVerifying ? (
                <><Loader2 size={14} className="animate-spin-custom" /> Verifying</>
              ) : (
                <>Verify →</>
              )}
            </button>

            <button
              onClick={() => { setStep("email"); setCode(""); setError(""); setSuccess(""); }}
              className="flex items-center justify-center gap-1.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] transition-colors hover:opacity-100"
              style={{ color: "rgba(245,245,245,0.5)", opacity: 0.7 }}
            >
              <ArrowLeft size={11} />
              Use a different email
            </button>
          </div>
        )}

        {/* Footer note */}
        <div className="mt-10 pt-5 border-t" style={{ borderColor: "rgba(245,245,245,0.06)" }}>
          <p className="font-serif italic text-[11.5px] leading-[1.5]" style={{ color: "rgba(245,245,245,0.4)" }}>
            Notes in the margins of your codebase.
          </p>
        </div>
      </div>
    </div>
  );
}
