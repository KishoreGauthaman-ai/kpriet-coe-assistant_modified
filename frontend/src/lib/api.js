import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api/v1";

const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("token");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    // A 401 from the password endpoints means "wrong current password", not an
    // expired/invalid token — do NOT force a logout for those.
    const url = err?.config?.url || "";
    const isPasswordCall =
      url.includes("/me/password") || url.includes("/me/verify-password");
    if (err?.response?.status === 401 && !isPasswordCall) {
      localStorage.removeItem("token");
      localStorage.removeItem("role");
      localStorage.removeItem("name");
      localStorage.removeItem("email");
      if (window.location.pathname !== "/login") window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

/* -- Auth -- */
export const login = (email, password) =>
  api.post("/login", { email, password }).then((r) => r.data);
export const register = (email, password, name) =>
  api.post("/register", { email, password, name }).then((r) => r.data);
export const getMe = () => api.get("/me").then((r) => r.data);

export const changePassword = (currentPassword, newPassword) =>
  api.post("/me/password", { current_password: currentPassword, new_password: newPassword }).then((r) => r.data);
export const verifyPassword = (password) =>
  api.post("/me/verify-password", { password }).then((r) => r.data);
export const adminResetPassword = (userId, newPassword) =>
  api.post(`/admin/users/${userId}/password`, { new_password: newPassword }).then((r) => r.data);

/* -- Chat -- */
export function chatStream({ message, reasoning, history }, callbacks) {
  const controller = new AbortController();
  const token = localStorage.getItem("token");
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    callbacks.onDone?.();
  };

  fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message, reasoning, history }),
    signal: controller.signal,
  })
    .then(async (resp) => {
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail || `Server error ${resp.status}`);
      }
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let currentEvent = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
            continue;
          }
          if (!line.startsWith("data:")) continue;

          const payload = line.slice(5).trim();
          if (currentEvent === "token") {
            callbacks.onToken?.(payload);
          } else if (currentEvent === "meta") {
            try {
              const parsed = JSON.parse(payload);
              callbacks.onMeta?.(parsed);
            } catch (_) {
              callbacks.onMeta?.({ raw: payload });
            }
          } else if (currentEvent === "done") {
            finish();
            return;
          } else if (currentEvent === "error") {
            callbacks.onError?.(payload.replace(/^\[ERROR\]\s*/, ""));
          } else {
            /* Unknown event type — treat as token for backward compat */
            callbacks.onToken?.(payload);
          }
          currentEvent = null;
        }
      }
      finish();
    })
    .catch((e) => {
      if (e.name === "AbortError") {
        // User pressed Stop — finish silently without an error bubble.
        callbacks.onAbort?.();
        finish();
        return;
      }
      callbacks.onError?.(e.message);
    });
  return controller;
}

/* -- Voice -- */
export const transcribeVoice = (audioBlob) => {
  const form = new FormData();
  form.append("file", audioBlob, "recording.webm");
  return api.post("/voice/transcribe", form).then((r) => r.data);
};

/* -- Ingest (admin) -- */
export const ingestFile = (file, onProgress) => {
  const form = new FormData();
  form.append("file", file);
  return api
    .post("/admin/ingest", form, {
      onUploadProgress: (e) =>
        onProgress?.(Math.round((100 * e.loaded) / (e.total || 1))),
    })
    .then((r) => r.data);
};
export const listFiles = () => api.get("/admin/files").then((r) => r.data);
export const deleteFile = (name) =>
  api.delete(`/admin/files/${encodeURIComponent(name)}`).then((r) => r.data);

/* -- Admin user management -- */
export const listUsers = () => api.get("/admin/users").then((r) => r.data);
export const approveUser = (userId) =>
  api.post(`/admin/users/${userId}/approve`).then((r) => r.data);
export const rejectUser = (userId) =>
  api.post(`/admin/users/${userId}/reject`).then((r) => r.data);

/* -- Sessions (localStorage only) -- */
const SESSIONS_KEY = "kpriet_coe_sessions";

export function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveSession(session) {
  const sessions = loadSessions().filter((s) => s.id !== session.id);
  sessions.unshift(session);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, 50)));
}

export function deleteSession(id) {
  const sessions = loadSessions().filter((s) => s.id !== id);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

export default api;