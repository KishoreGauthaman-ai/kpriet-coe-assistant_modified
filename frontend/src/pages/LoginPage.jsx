import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login, register } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login: doLogin } = useAuth() || {};
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (isRegister) {
      if (!name.trim()) return setError("Name is required");
      if (!email) return setError("Email is required");
      if (password.length < 6) return setError("Password must be at least 6 characters");
      if (password !== confirmPassword) return setError("Passwords do not match");
    } else {
      if (!email || !password) return setError("Email and password are required");
    }

    setLoading(true);
    try {
      if (isRegister) {
        const res = await register(email, password, name.trim());
        localStorage.setItem("token", res.access_token);
        localStorage.setItem("role", res.role);
        localStorage.setItem("name", res.name);
        localStorage.setItem("email", res.email || email);
        doLogin?.(res);
        if (res.role === "pending") {
          setSuccess("Account created! Awaiting admin approval. You'll be notified once approved.");
        } else {
          navigate(res.role === "admin" ? "/admin" : "/student", { replace: true });
        }
      } else {
        const res = await login(email, password);
        localStorage.setItem("token", res.access_token);
        localStorage.setItem("role", res.role);
        localStorage.setItem("name", res.name);
        localStorage.setItem("email", res.email || email);
        doLogin?.(res);
        navigate(res.role === "admin" ? "/admin" : "/student", { replace: true });
      }
    } catch (err) {
      setError(err?.response?.data?.detail || (isRegister ? "Registration failed. Please try again." : "Login failed. Check your credentials and try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm glass-card rounded-3xl p-8 space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-main">KPRIET COE Assistant</h1>
          <p className="text-sm text-muted">
            {isRegister ? "Create your institutional account" : "Sign in with your institutional account"}
          </p>
        </div>

        {error && (
          <div role="alert" aria-live="polite" className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2 text-center">
            {error}
          </div>
        )}

        {success && (
          <div role="status" aria-live="polite" className="text-sm text-green-400 bg-green-900/20 border border-green-800 rounded-lg px-3 py-2 text-center">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegister && (
            <div>
              <label htmlFor="name" className="block text-xs font-medium text-muted mb-1">Full Name</label>
              <input
                id="name"
                type="text"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name…"
                autoComplete="name"
                autoFocus
                required
                className="w-full glass-input rounded-xl px-4 py-3 text-sm text-main
                  placeholder:text-faint outline-none focus-visible:ring-2 focus-visible:ring-accent/60
                  transition-colors"
              />
            </div>
          )}
          <div>
            <label htmlFor="email" className="block text-xs font-medium text-muted mb-1">Email</label>
            <input
              id="email"
              type="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@kpriet…"
              autoComplete="email"
              autoFocus={!isRegister}
              spellCheck={false}
              required
              className="w-full glass-input rounded-xl px-4 py-3 text-sm text-main
                placeholder:text-faint outline-none focus-visible:ring-2 focus-visible:ring-accent/60
                transition-colors"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-xs font-medium text-muted mb-1">Password</label>
            <input
              id="password"
              type="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password…"
              autoComplete={isRegister ? "new-password" : "current-password"}
              required
              minLength={isRegister ? 6 : 1}
              className="w-full glass-input rounded-xl px-4 py-3 text-sm text-main
                placeholder:text-faint outline-none focus-visible:ring-2 focus-visible:ring-accent/60
                transition-colors"
            />
          </div>
          {isRegister && (
            <div>
              <label htmlFor="confirm-password" className="block text-xs font-medium text-muted mb-1">Confirm Password</label>
              <input
                id="confirm-password"
                type="password"
                name="confirm-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password…"
                autoComplete="new-password"
                required
                className="w-full glass-input rounded-xl px-4 py-3 text-sm text-main
                  placeholder:text-faint outline-none focus-visible:ring-2 focus-visible:ring-accent/60
                  transition-colors"
              />
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent hover:bg-accent-soft
              text-white font-medium py-3 rounded-xl text-sm
              disabled:opacity-50 disabled:cursor-not-allowed
              focus-visible:ring-2 focus-visible:ring-accent/60 outline-none
              transition-colors duration-150"
          >
            {loading ? (isRegister ? "Creating account…" : "Signing in…") : (isRegister ? "Create Account" : "Sign In")}
          </button>
        </form>

        <p className="text-center text-sm text-muted">
          {isRegister ? "Already have an account? " : "Don't have an account? "}
          <button
            type="button"
            onClick={() => {
              setIsRegister(!isRegister);
              setError(null);
              setSuccess(null);
            }}
            className="text-accent-reasoning-on hover:underline font-medium focus-visible:ring-2 focus-visible:ring-accent/60 outline-none rounded"
          >
            {isRegister ? "Sign In" : "Create Account"}
          </button>
        </p>

        {!isRegister && (
          <p className="text-[10px] text-center text-faint">Default admin: admin@kpriet.ac.in</p>
        )}
      </div>
    </div>
  );
}
