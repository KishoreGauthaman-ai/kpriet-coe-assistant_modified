import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  CircleCheck,
  CircleHelp,
  Lock,
  Moon,
  Palette,
  RotateCcw,
  Settings as SettingsIcon,
  Sun,
  User,
  X,
} from "lucide-react";
import { useAuth } from "../lib/auth.js";
import { changePassword, verifyPassword } from "../lib/api.js";
import { useSettings, ACCENT_COLORS } from "../lib/settings.js";

export default function ProfilePanel({ collapsed }) {
  const { user } = useAuth() || {};
  const { settings, update, reset, accent } = useSettings();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("profile");
  const [pwOpen, setPwOpen] = useState(false);
  const pwTriggerRef = useRef(null);

  const name = user?.name || localStorage.getItem("name") || "User";
  const email = user?.email || localStorage.getItem("email") || "account@kpriet";

  const setTheme = (theme) => update({ theme });

  const NAV = [
    ["profile", <User size={16} aria-hidden="true" focusable="false" />, "Profile"],
    ["settings", <Palette size={16} aria-hidden="true" focusable="false" />, "Settings"],
    ["help", <CircleHelp size={16} aria-hidden="true" focusable="false" />, "Help & Support"],
  ];

  const CloseIconBtn = (
    <button
      onClick={() => setOpen(false)}
      className="shrink-0 w-8 h-8 rounded-full glass-subtle flex items-center justify-center text-muted hover:text-[#ef4444] transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
      aria-label="Close"
    >
      <X size={16} aria-hidden="true" focusable="false" />
    </button>
  );

  return (
    <>
      {/* Bottom profile card + settings */}
      {!collapsed ? (
        <div className="border-t border-app p-3 flex items-center gap-2">
          <button
            onClick={() => setOpen(true)}
            className="flex-1 flex items-center gap-3 glass-card rounded-2xl px-3 py-2.5 text-left hover:border-accent/50 transition-colors"
          >
            <div className="shrink-0 w-9 h-9 rounded-full bg-accent text-white flex items-center justify-center text-sm font-bold">
              {name?.[0]?.toUpperCase() || "U"}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-main truncate">{name}</p>
              <p className="text-xs text-muted truncate">{email}</p>
            </div>
          </button>
          <button
            onClick={() => { setOpen(true); setTab("settings"); }}
            className="shrink-0 w-9 h-9 rounded-xl glass-subtle flex items-center justify-center text-muted hover:text-main hover:border-accent/40 transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
            aria-label="Open settings"
            title="Settings"
          >
            <SettingsIcon size={16} aria-hidden="true" focusable="false" />
          </button>
        </div>
      ) : (
        <div className="border-t border-app p-3 flex flex-col items-center gap-2">
          <button
            onClick={() => setOpen(true)}
            className="w-9 h-9 rounded-full bg-accent text-white flex items-center justify-center text-sm font-bold focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
            aria-label="Open profile"
            title="Profile"
          >
            {name?.[0]?.toUpperCase() || "U"}
          </button>
          <button
            onClick={() => { setOpen(true); setTab("settings"); }}
            className="w-9 h-9 rounded-lg glass-subtle flex items-center justify-center text-muted hover:text-main transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
            aria-label="Open settings"
            title="Settings"
          >
            <SettingsIcon size={16} aria-hidden="true" focusable="false" />
          </button>
        </div>
      )}

      {/* Modal — large centered window with vertical nav (Change 2) */}
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            style={{ overscrollBehavior: "contain" }}
            onClick={() => setOpen(false)}
            onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          >
          <div
            className="relative w-full max-w-3xl h-[80vh] glass-card rounded-2xl overflow-hidden flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-label={NAV.find(([id]) => id === tab)?.[2] || "Settings"}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-app shrink-0">
              <h2 className="text-lg font-semibold text-main">
                {NAV.find(([id]) => id === tab)?.[2] || "Settings"}
              </h2>
              {CloseIconBtn}
            </div>

            {/* Body: left vertical nav + right content */}
            <div className="flex-1 flex min-h-0">
              {/* Vertical nav (llama.cpp / OpenAI-compatible style) */}
              <nav className="w-52 shrink-0 border-r border-app p-3 space-y-1 overflow-y-auto">
                {NAV.map(([id, icon, label]) => (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    aria-pressed={tab === id}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none ${
                      tab === id
                        ? "bg-accent text-white"
                        : "text-muted hover:bg-white/5 hover:text-main"
                    }`}
                  >
                    <span className="text-base" aria-hidden="true">{icon}</span>
                    <span className="font-medium">{label}</span>
                  </button>
                ))}
              </nav>

              {/* Content pane */}
              <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
                {tab === "profile" && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      <div className="shrink-0 w-16 h-16 rounded-full bg-accent text-white flex items-center justify-center text-2xl font-bold">
                        {name?.[0]?.toUpperCase() || "U"}
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-main">{name}</h3>
                        <p className="text-sm text-muted">{email}</p>
                        <p className="text-xs text-faint">Role: {user?.role || "student"}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setTab("settings")}
                        className="flex-1 bg-accent/20 hover:bg-accent/30 text-main border border-accent/40 rounded-xl py-2 text-sm transition-colors"
                      >
                        Settings
                      </button>
                      <button
                        onClick={() => setTab("help")}
                        className="flex-1 glass-subtle text-muted hover:text-main rounded-xl py-2 text-sm transition-colors"
                      >
                        Help
                      </button>
                    </div>
                  </div>
                )}

                {tab === "settings" && (
                  <div className="space-y-6 max-w-md">
                    {/* Theme */}
                    <div>
                      <p className="text-sm font-medium text-main mb-2">Theme</p>
                      <div className="grid grid-cols-2 gap-2">
                        {[["dark", <Moon size={16} aria-hidden="true" />, "Dark"], ["light", <Sun size={16} aria-hidden="true" />, "Light"]].map(([val, iconEl, label]) => (
                          <button
                            key={val}
                            onClick={() => setTheme(val)}
                            aria-pressed={settings.theme === val}
                            className={`rounded-xl py-2 text-sm transition-colors border focus-visible:ring-2 focus-visible:ring-accent/60 outline-none inline-flex items-center justify-center gap-2 ${
                              settings.theme === val
                                ? "bg-accent/25 border-accent/50 text-main"
                                : "glass-subtle text-muted hover:text-main"
                            }`}
                          >
                            {iconEl}{label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Accent colour */}
                    <div>
                      <p className="text-sm font-medium text-main mb-2">Icon colour</p>
                      <div className="flex gap-2">
                        {ACCENT_COLORS.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => setAccentColor(c.id)}
                            style={{ background: c.value }}
                            aria-label={`Set icon colour to ${c.id}`}
                            aria-pressed={settings.accent === c.id}
                            className={`w-9 h-9 rounded-full transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-accent/60 outline-none ${
                              settings.accent === c.id
                                ? "ring-2 ring-offset-2 ring-[#fff] scale-110"
                                : ""
                            }`}
                            title={c.id}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Reset to default */}
                    <div>
                      <button
                        onClick={() => {
                          reset();
                          setTab("profile");
                        }}
                        className="w-full glass-subtle text-muted hover:text-main hover:border-accent/40 rounded-xl py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
                      >
                        <span className="inline-flex items-center gap-2 justify-center"><RotateCcw size={14} aria-hidden="true" /> Reset to default</span>
                      </button>
                      <p className="mt-1 text-[11px] text-faint">
                        Restores dark theme &amp; purple icon colour for your account.
                      </p>
                    </div>

                    {/* Change password (opens two-step dialog) */}
                    <div>
                      <button
                        ref={pwTriggerRef}
                        onClick={() => setPwOpen(true)}
                        className="w-full bg-accent/25 hover:bg-accent/40 text-main border border-accent/50 rounded-xl py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
                      >
                        <span className="inline-flex items-center gap-2 justify-center"><Lock size={14} aria-hidden="true" /> Change password</span>
                      </button>
                      <p className="mt-1 text-[11px] text-faint">
                        Opens a secure two-step dialog — your current password is verified before you set a
                        new one.
                      </p>
                    </div>
                  </div>
                )}

                {tab === "help" && (
                  <div className="space-y-3 text-sm">
                    <h3 className="text-base font-semibold text-main">Help & Support</h3>

                    {/* Getting started */}
                    <div className="glass-subtle rounded-xl p-3 space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-accent-soft">Getting started</p>
                      <p className="text-muted leading-relaxed">
                        Type a question in the box and press <strong>Enter</strong> to send, or click the
                        {" "}<strong>↑</strong> send button. Use <b>Shift + Enter</b> to add a new line.
                      </p>
                      <p className="text-muted leading-relaxed">
                        Ask about courses, career paths, attendance, COE lab facilities, guidelines and budget
                        documents. The assistant answers only from the uploaded knowledge base.
                      </p>
                    </div>

                    {/* Reasoning */}
                    <div className="glass-subtle rounded-xl p-3 space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-accent-soft">Reasoning mode</p>
                      <p className="text-muted leading-relaxed">
                        Toggle <b>Reasoning</b> next to the input box for personalised, step-by-step mentoring
                        answers. Use it for guidance on career planning, placements and study-roadmaps. Leave it
                        off for quick factual answers.
                      </p>
                    </div>

                    {/* Voice input */}
                    <div className="glass-subtle rounded-xl p-3 space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-accent-soft">Voice input</p>
                      <p className="text-muted leading-relaxed">
                        Tap the <b>mic icon</b> inside the text box, speak your question, then tap again to stop and
                        send. Grant microphone access in the browser when prompted. Your audio is processed
                        locally by the assistant server.
                      </p>
                    </div>

                    {/* Stop / streaming */}
                    <div className="glass-subtle rounded-xl p-3 space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-accent-soft">Managing replies</p>
                      <p className="text-muted leading-relaxed">
                        While a reply is being generated, the send button turns into a <b>stop ■</b> square —
                        click it or press <b>Enter</b> to end the response early.
                      </p>
                      <p className="text-muted leading-relaxed">
                        Start a fresh conversation with the <b>+</b> button at the top of the sidebar. Old chats
                        are auto-saved and can be reopened from the sidebar; hover a chat and click the trash icon to
                        delete it.
                      </p>
                    </div>

                    {/* Appearance */}
                    <div className="glass-subtle rounded-xl p-3 space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-accent-soft">Appearance</p>
                      <p className="text-muted leading-relaxed">
                        Switch between dark / light themes and pick a highlight <b>icon colour</b> from the
                        <b> Settings</b> tab. Your choices are saved to your account and remembered next time.
                      </p>
                    </div>

                    {/* Admin-only */}
                    {user?.role === "admin" && (
                      <div className="glass-subtle rounded-xl p-3 space-y-1.5 border border-accent/40">
                        <p className="text-xs font-semibold uppercase tracking-wide text-accent-soft">For Admins</p>
                        <p className="text-muted leading-relaxed">
                          Use the <b>Admin Portal</b> to upload or remove documents (PDF, DOCX, CSV, Excel, TXT/MD
                          — including tables), review and approve new student accounts, reset passwords and manage
                          indexed content.
                        </p>
                      </div>
                    )}

                    {/* Troubleshooting */}
                    <div className="glass-subtle rounded-xl p-3 space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-accent-soft">Troubleshooting</p>
                      <p className="text-muted leading-relaxed">
                        • <b>"No relevant documents found"</b> — your question is outside the knowledge base.
                        Reword it or upload the related material.
                      </p>
                      <p className="text-muted leading-relaxed">
                        • Mic not working — check browser permissions and that no other app is using the mic.
                      </p>
                      <p className="text-muted leading-relaxed">
                        • Wrong password — use <b>Change password</b> in Settings; admins can reset student
                        passwords from the Admin Portal.
                      </p>
                    </div>

                    {/* Contact */}
                    <div className="glass-subtle rounded-xl p-3 space-y-1 text-xs text-faint">
                      <p>support@kpriet.edu</p>
                      <p>KPRIET, Coimbatore, TN</p>
                      <p>Mon–Sat · 9:00 AM – 5:00 PM</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Change-password dialog (Change 1) */}
      <ChangePasswordDialog
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        triggerRef={pwTriggerRef}
      />
    </>
  );

  function setAccentColor(id) {
    update({ accent: id });
  }
}

/* ------------------------------------------------------------------ */
/* Two-step change-password dialog: verify current → then set new.     */
/* ------------------------------------------------------------------ */
function ChangePasswordDialog({ open, onClose, triggerRef }) {
  const [step, setStep] = useState("verify"); // "verify" | "change" | "done"
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open || !triggerRef?.current) return;

    const updatePosition = () => {
      const rect = triggerRef.current.getBoundingClientRect();
      // Position above the trigger button with a small gap
      setPosition({
        top: rect.top - 8, // 8px gap above the button
        left: rect.left,
        width: rect.width,
      });
    };

    updatePosition();
    window.addEventListener("scroll", updatePosition);
    window.addEventListener("resize", updatePosition);
    const onKey = (e) => {
      if (e.key === "Escape") closeRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", updatePosition);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, triggerRef]);

  if (!open) return null;

  const reset = () => {
    setStep("verify");
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };
  closeRef.current = close;

  const handleVerify = async () => {
    setError(null);
    if (!current) return setError("Enter your current password");
    setLoading(true);
    try {
      const res = await verifyPassword(current);
      if (!res.valid) {
        setError("Current password is incorrect");
        return;
      }
      setStep("change");
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not verify password");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = async () => {
    setError(null);
    if (next.length < 6) return setError("New password must be at least 6 characters");
    if (next !== confirm) return setError("New passwords do not match");
    setLoading(true);
    try {
      await changePassword(current, next);
      setStep("done");
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to update password");
    } finally {
      setLoading(false);
    }
  };

  const dialogStyle = position
    ? {
        position: "fixed",
        bottom: `calc(100vh - ${position.top}px + 8px)`,
        left: position.left + (position.width - 360) / 2,
        zIndex: 60,
        minWidth: 360,
        maxWidth: 360,
      }
    : { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 60 };

  return createPortal(
    <div
      className="fixed inset-0 z-[60]"
      onClick={close}
      style={{ background: "transparent" }}
    >
      <div
        style={dialogStyle}
        className="glass-card rounded-2xl p-6"
        role="dialog"
        aria-modal="true"
        aria-label="Change password"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={close}
          className="absolute top-4 right-4 w-8 h-8 rounded-full glass-subtle flex items-center justify-center text-muted hover:text-[#ef4444] transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
          aria-label="Close"
          title="Close"
        >
          <X size={16} aria-hidden="true" focusable="false" />
        </button>

        {step === "verify" && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-main">Verify your password</h3>
            <p className="text-sm text-muted leading-relaxed">
              Enter your current password to continue. You will set a new one on the next step.
            </p>
            <div>
              <label htmlFor="current-password" className="block text-xs font-medium text-muted mb-1">Current password</label>
              <input
                id="current-password"
                type="password"
                name="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                placeholder="Current password…"
                autoComplete="current-password"
                autoFocus
                className="w-full glass-input rounded-xl px-3 py-2 text-sm text-main placeholder:text-faint outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              />
            </div>
            {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
            <button
              onClick={handleVerify}
              disabled={loading}
              className="w-full bg-accent/25 hover:bg-accent/40 text-main border border-accent/50 rounded-xl py-2 text-sm transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
            >
              {loading ? "Verifying…" : "Verify & continue"}
            </button>
          </div>
        )}

        {step === "change" && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-main">Set a new password</h3>
            <div>
              <label htmlFor="new-password" className="block text-xs font-medium text-muted mb-1">New password</label>
              <input
                id="new-password"
                type="password"
                name="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                placeholder="New password (min 6 chars)…"
                autoComplete="new-password"
                className="w-full glass-input rounded-xl px-3 py-2 text-sm text-main placeholder:text-faint outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              />
            </div>
            <div>
              <label htmlFor="confirm-password" className="block text-xs font-medium text-muted mb-1">Confirm new password</label>
              <input
                id="confirm-password"
                type="password"
                name="confirm-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleChange()}
                placeholder="Confirm new password…"
                autoComplete="new-password"
                className="w-full glass-input rounded-xl px-3 py-2 text-sm text-main placeholder:text-faint outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              />
            </div>
            {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => { setStep("verify"); setError(null); }}
                className="flex-1 glass-subtle text-muted hover:text-main rounded-xl py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
              >
                Back
              </button>
              <button
                onClick={handleChange}
                disabled={loading}
                className="flex-1 bg-accent/25 hover:bg-accent/40 text-main border border-accent/50 rounded-xl py-2 text-sm transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
              >
                {loading ? "Updating…" : "Update password"}
              </button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4 text-center">
            <CircleCheck size={24} className="mx-auto text-accent-soft" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-main">Password updated</h3>
            <p className="text-sm text-muted">Your password was changed successfully.</p>
            <button
              onClick={close}
              className="w-full bg-accent/25 hover:bg-accent/40 text-main border border-accent/50 rounded-xl py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
