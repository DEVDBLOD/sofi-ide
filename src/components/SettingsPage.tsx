"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

export default function SettingsPage() {
  const [allowedEmail, setAllowedEmail] = useState(
    process.env.NEXT_PUBLIC_ALLOWED_EMAIL || "***@***.com"
  );
  const [newEmail, setNewEmail] = useState("");
  const [emailSaved, setEmailSaved] = useState(false);

  function handleSaveEmail() {
    const email = newEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) return;
    setAllowedEmail(email);
    setNewEmail("");
    setEmailSaved(true);
    setTimeout(() => setEmailSaved(false), 3000);
  }

  return (
    <div className="flex-1 flex justify-center overflow-auto relative" style={{ background: "#0a0a0a" }}>
      <div className="aurora pointer-events-none"><div className="lamp" /><div className="lamp lamp-2" /><div className="grain" /></div>

      <div className="w-full max-w-[680px] py-14 px-8 relative z-10">
        {/* Eyebrow */}
        <div className="flex items-center gap-2 mb-5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#ffffff" }} />
          <span className="font-mono text-[10px] uppercase tracking-[0.32em]" style={{ color: "rgba(245,245,245,0.5)", fontWeight: 600 }}>
            Workspace · Settings
          </span>
        </div>

        {/* Title */}
        <h1
          className="font-serif select-none mb-2"
          style={{ color: "#ffffff", fontWeight: 900, fontSize: 56, lineHeight: 0.95, letterSpacing: "-0.035em" }}
        >
          Settings.
        </h1>
        <p
          className="font-serif italic mb-12"
          style={{ color: "rgba(245,245,245,0.5)", fontWeight: 300, fontSize: 16, lineHeight: 1.45 }}
        >
          Access, identity, and preferences for this workspace.
        </p>

        {/* Section: Access Control */}
        <section className="mb-10">
          <div className="flex items-baseline gap-3 mb-5">
            <span className="font-mono text-[10px] uppercase tracking-[0.32em]" style={{ color: "rgba(245,245,245,0.4)", fontWeight: 600 }}>
              01
            </span>
            <h2 className="font-serif" style={{ color: "#ffffff", fontSize: 22, fontWeight: 600, letterSpacing: "-0.015em" }}>
              Access control
            </h2>
            <span className="flex-1 border-b" style={{ borderColor: "rgba(245,245,245,0.06)" }} />
          </div>

          <p className="font-serif italic mb-6 max-w-[480px]" style={{ color: "rgba(245,245,245,0.55)", fontSize: 14, lineHeight: 1.55 }}>
            Only the email below can sign in. Updates take effect on the next login.
          </p>

          {/* Current value */}
          <div className="mb-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] mb-1.5" style={{ color: "rgba(245,245,245,0.4)" }}>
              Currently authorized
            </div>
            <div className="font-mono text-[15px] pb-2" style={{ color: "#ffffff", borderBottom: "1px solid rgba(245,245,245,0.1)" }}>
              {allowedEmail}
            </div>
          </div>

          {/* New email form */}
          <div className="mb-4">
            <label className="font-mono text-[10px] uppercase tracking-[0.22em] block mb-1.5" style={{ color: "rgba(245,245,245,0.5)" }}>
              Replace with
            </label>
            <div className="flex items-stretch gap-3">
              <input
                value={newEmail}
                onChange={(e) => { setNewEmail(e.target.value); setEmailSaved(false); }}
                onKeyDown={(e) => e.key === "Enter" && handleSaveEmail()}
                placeholder="new@email.com"
                type="email"
                className="flex-1 bg-transparent font-serif italic outline-none transition-colors pb-2"
                style={{
                  color: "#ffffff",
                  fontSize: 18,
                  borderBottom: "1px solid rgba(245,245,245,0.2)",
                }}
              />
              <button
                onClick={handleSaveEmail}
                disabled={!newEmail.trim()}
                className="font-mono uppercase tracking-[0.18em] px-5 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                style={{ background: "#ffffff", color: "#0a0a0a", fontSize: 11, fontWeight: 700, height: 38 }}
              >
                Save →
              </button>
            </div>
          </div>

          {emailSaved && (
            <div
              className="font-mono text-[10.5px] uppercase tracking-[0.18em] px-3 py-2 animate-fade-in"
              style={{ color: "#ffffff", background: "rgba(255,255,255,0.05)", borderLeft: "2px solid #ffffff" }}
            >
              Email updated
            </div>
          )}
        </section>

        {/* Footer note */}
        <div className="mt-16 pt-5 border-t" style={{ borderColor: "rgba(245,245,245,0.06)" }}>
          <p className="font-serif italic text-[11.5px] leading-[1.5]" style={{ color: "rgba(245,245,245,0.4)" }}>
            Notes in the margins of your codebase.
          </p>
        </div>
      </div>
    </div>
  );
}
