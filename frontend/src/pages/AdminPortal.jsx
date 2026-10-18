import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { listFiles, deleteFile, listUsers, approveUser, rejectUser, adminResetPassword } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import AdminDropzone from "../components/AdminDropzone.jsx";

export default function AdminPortal() {
  const navigate = useNavigate();
  const { logout } = useAuth() || {};
  const [files, setFiles] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(true);
  const [error, setError] = useState(null);
  const [usersError, setUsersError] = useState(null);
  const role = localStorage.getItem("role");
  const [activeTab, setActiveTab] = useState("documents");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmReject, setConfirmReject] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetValue, setResetValue] = useState("");

  /* Enforce admin-only at the render level */
  useEffect(() => {
    if (role !== "admin") navigate("/student", { replace: true });
  }, [role, navigate]);

  const refreshFiles = useCallback(() => {
    setLoading(true);
    setError(null);
    listFiles()
      .then(setFiles)
      .catch((err) => setError(err?.response?.data?.detail || err.message))
      .finally(() => setLoading(false));
  }, []);

  const refreshUsers = useCallback(() => {
    setUsersLoading(true);
    setUsersError(null);
    listUsers()
      .then(setUsers)
      .catch((err) => setUsersError(err?.response?.data?.detail || err.message))
      .finally(() => setUsersLoading(false));
  }, []);

  useEffect(() => {
    refreshFiles();
    refreshUsers();
  }, [refreshFiles, refreshUsers]);

  const handleDelete = useCallback(async (name) => {
    try {
      await deleteFile(name);
      setFiles((p) => p.filter((f) => f.file_name !== name));
      setError(null);
    } catch (err) {
      setError(err?.response?.data?.detail || err.message);
      setTimeout(() => setError(null), 3000);
    }
  }, []);

  const handleApprove = useCallback(async (userId) => {
    try {
      await approveUser(userId);
      setUsers((u) => u.map((usr) => (usr.id === userId ? { ...usr, role: "student" } : usr)));
      setUsersError(null);
    } catch (err) {
      setUsersError(err?.response?.data?.detail || err.message);
      setTimeout(() => setUsersError(null), 3000);
    }
  }, []);

  const handleReject = useCallback(async (userId) => {
    try {
      await rejectUser(userId);
      setUsers((u) => u.filter((usr) => usr.id !== userId));
      setUsersError(null);
    } catch (err) {
      setUsersError(err?.response?.data?.detail || err.message);
      setTimeout(() => setUsersError(null), 3000);
    }
  }, []);

  const handleResetPassword = useCallback(async (userId, newPassword) => {
    try {
      await adminResetPassword(userId, newPassword);
      setUsersError(null);
      return { ok: true };
    } catch (err) {
      setUsersError(err?.response?.data?.detail || err.message);
      setTimeout(() => setUsersError(null), 3000);
      return { ok: false };
    }
  }, []);

  const handleLogout = () => {
    logout?.();
    navigate("/login", { replace: true });
  };

  const pendingUsers = users.filter((u) => u.role === "pending");
  const activeUsers = users.filter((u) => u.role !== "pending" && u.role !== "admin");

  return (
    <div className="min-h-screen bg-app flex flex-col">
      {/* Admin header */}
      <header className="border-b border-app bg-inside/80 backdrop-blur-xl px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-main">KPRIET COE — Admin</h1>
          <span className="text-[10px] bg-accent/20 text-accent-reasoning-on px-2 py-0.5 rounded-full font-medium">
            admin
          </span>
        </div>
        <button
          onClick={handleLogout}
          className="px-4 py-1.5 rounded-lg text-xs glass-subtle text-muted hover:border-accent/40 hover:text-main transition-colors"
        >
          Log out
        </button>
      </header>

      {/* Tab navigation */}
      <nav className="flex border-b border-app bg-inside/80 backdrop-blur-xl px-6">
        <button
          onClick={() => setActiveTab("documents")}
          aria-pressed={activeTab === "documents"}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none ${
            activeTab === "documents"
              ? "border-accent text-[#a78bfa]"
              : "border-transparent text-faint hover:text-main"
          }`}
        >
          Documents ({files.length})
        </button>
        <button
          onClick={() => setActiveTab("users")}
          aria-pressed={activeTab === "users"}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none ${
            activeTab === "users"
              ? "border-accent text-[#a78bfa]"
              : "border-transparent text-faint hover:text-main"
          }`}
        >
          Pending Approvals ({pendingUsers.length})
        </button>
        <button
          onClick={() => setActiveTab("allUsers")}
          aria-pressed={activeTab === "allUsers"}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none ${
            activeTab === "allUsers"
              ? "border-accent text-[#a78bfa]"
              : "border-transparent text-faint hover:text-main"
          }`}
        >
          All Users ({activeUsers.length})
        </button>
      </nav>

      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-8 space-y-8">
        {activeTab === "documents" && (
          <>
            {/* Upload zone */}
            <section>
              <AdminDropzone onSuccess={refreshFiles} />
            </section>

            {/* Indexed files table */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-[#a78bfa]">
                  Indexed Documents ({files.length})
                </h2>
                <button
                  onClick={refreshFiles}
                  disabled={loading}
                  className="text-[10px] text-faint hover:text-main transition-colors"
                >
                  Refresh
                </button>
              </div>

              {loading ? (
                <p className="text-xs text-[#4b5563] py-6 text-center flex items-center justify-center gap-2">
                  <span className="animate-spin inline-block w-4 h-4 border-2 border-transparent border-t-accent rounded-full" />
                  Fetching files…
                </p>
              ) : error ? (
                <p className="text-xs text-red-400 py-6 text-center">
                  {error}
                </p>
              ) : files.length === 0 ? (
                <p className="text-xs text-[#4b5563] py-6 text-center">
                  No documents indexed yet. Drop a PDF or DOCX above.
                </p>
              ) : (
                <div className="glass-card rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-white/5 text-[#6b7280] text-xs uppercase tracking-wider">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium">File</th>
                        <th className="text-left px-4 py-2 font-medium">Chunks</th>
                        <th className="text-left px-4 py-2 font-medium">Status</th>
                        <th className="px-4 py-2 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {files.map((f) => (
                        <tr
                          key={f.file_name}
                          className="border-t border-app hover:bg-white/5 transition-colors"
                        >
                          <td className="px-4 py-2.5 text-[#d1d5db] text-xs truncate max-w-[300px]">
                            {f.file_name}
                          </td>
                          <td className="px-4 py-2.5 text-muted text-xs">
                            {f.chunk_count}
                          </td>
                          <td className="px-4 py-2.5 text-xs">
                            {f.status === "ok" ? (
                              <span className="text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded">
                                Active
                              </span>
                            ) : (
                              <span className="text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded">
                                Failed
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              onClick={() => setConfirmDelete(f.file_name)}
                              className="text-xs text-red-400 hover:text-red-300 border border-red-400/20 px-2 py-1 rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {activeTab === "users" && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[#a78bfa]">
                Users Awaiting Approval ({pendingUsers.length})
              </h2>
              <button
                onClick={refreshUsers}
                disabled={usersLoading}
                className="text-[10px] text-faint hover:text-main transition-colors"
              >
                Refresh
              </button>
            </div>

            {usersLoading ? (
              <p className="text-xs text-[#4b5563] py-6 text-center flex items-center justify-center gap-2">
                <span className="animate-spin inline-block w-4 h-4 border-2 border-transparent border-t-accent rounded-full" />
                Fetching users…
              </p>
            ) : usersError ? (
              <p className="text-xs text-red-400 py-6 text-center">
                {usersError}
              </p>
            ) : pendingUsers.length === 0 ? (
              <p className="text-xs text-[#4b5563] py-6 text-center">
                No pending approvals.
              </p>
            ) : (
              <div className="glass-card rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-white/5 text-[#6b7280] text-xs uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Name</th>
                      <th className="text-left px-4 py-2 font-medium">Email</th>
                      <th className="text-left px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingUsers.map((u) => (
                      <tr
                        key={u.id}
                        className="border-t border-app hover:bg-white/5 transition-colors"
                      >
                        <td className="px-4 py-2.5 text-[#d1d5db] text-xs truncate max-w-[200px]">
                          {u.name || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-muted text-xs truncate max-w-[250px]">
                          {u.email}
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          <span className="text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded">
                            Pending
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right flex items-center justify-end gap-2">
                          <button
                            onClick={() => { setResetTarget(u); setResetValue(""); }}
                            className="text-xs text-blue-400 hover:text-blue-300 border border-blue-400/20 px-2 py-1 rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
                          >
                            Reset password
                          </button>
                          <button
                            onClick={() => handleApprove(u.id)}
                            className="text-xs text-green-400 hover:text-green-300 border border-green-400/20 px-2 py-1 rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => setConfirmReject(u)}
                            className="text-xs text-red-400 hover:text-red-300 border border-red-400/20 px-2 py-1 rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
                          >
                            Reject
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {activeTab === "allUsers" && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[#a78bfa]">
                Active Students ({activeUsers.length})
              </h2>
              <button
                onClick={refreshUsers}
                disabled={usersLoading}
                className="text-[10px] text-faint hover:text-main transition-colors"
              >
                Refresh
              </button>
            </div>

            {usersLoading ? (
              <p className="text-xs text-[#4b5563] py-6 text-center flex items-center justify-center gap-2">
                <span className="animate-spin inline-block w-4 h-4 border-2 border-transparent border-t-accent rounded-full" />
                Fetching users…
              </p>
            ) : activeUsers.length === 0 ? (
              <p className="text-xs text-[#4b5563] py-6 text-center">
                No active student accounts yet.
              </p>
            ) : (
              <div className="glass-card rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-white/5 text-[#6b7280] text-xs uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Name</th>
                      <th className="text-left px-4 py-2 font-medium">Email</th>
                      <th className="text-left px-4 py-2 font-medium">Role</th>
                      <th className="px-4 py-2 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeUsers.map((u) => (
                      <tr
                        key={u.id}
                        className="border-t border-app hover:bg-white/5 transition-colors"
                      >
                        <td className="px-4 py-2.5 text-[#d1d5db] text-xs truncate max-w-[200px]">
                          {u.name || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-muted text-xs truncate max-w-[250px]">
                          {u.email}
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          <span className="text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded">
                            {u.role}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => { setResetTarget(u); setResetValue(""); }}
                            className="text-xs text-blue-400 hover:text-blue-300 border border-blue-400/20 px-2 py-1 rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
                          >
                            Reset password
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {error && (
          <div role="alert" aria-live="polite" className="fixed bottom-6 right-6 z-50 bg-red-900/30 border border-red-800 rounded-xl px-4 py-2 text-xs text-red-400 max-w-xs backdrop-blur-xl">
            {error}
          </div>
        )}
        {usersError && (
          <div role="alert" aria-live="polite" className="fixed bottom-6 left-6 z-50 bg-red-900/30 border border-red-800 rounded-xl px-4 py-2 text-xs text-red-400 max-w-xs backdrop-blur-xl">
            {usersError}
          </div>
        )}
      </main>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete document?"
          body={`"${confirmDelete}" will be removed from the knowledge base. This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => { handleDelete(confirmDelete); setConfirmDelete(null); }}
        />
      )}

      {/* Reject confirmation modal */}
      {confirmReject && (
        <ConfirmDialog
          title="Reject this user?"
          body={`${confirmReject.name || "This user"} (${confirmReject.email}) will not be granted access.`}
          confirmLabel="Reject"
          danger
          onCancel={() => setConfirmReject(null)}
          onConfirm={() => { handleReject(confirmReject.id); setConfirmReject(null); }}
        />
      )}

      {/* Reset password modal */}
      {resetTarget && (
        <ResetPasswordDialog
          email={resetTarget.email}
          value={resetValue}
          onChange={setResetValue}
          onCancel={() => setResetTarget(null)}
          onConfirm={async () => {
            if (resetValue.length < 6) {
              setUsersError("Password must be at least 6 characters");
              setTimeout(() => setUsersError(null), 3000);
              return;
            }
            const res = await handleResetPassword(resetTarget.id, resetValue);
            if (res?.ok) setResetTarget(null);
          }}
        />
      )}
    </div>
  );
}

/* Shared minimal dialog shell with ESC + backdrop close */
function DialogShell({ title, children, onCancel }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      style={{ overscrollBehavior: "contain" }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm glass-card rounded-2xl p-6"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-main mb-2">{title}</h2>
        <div className="text-sm text-muted mb-6 space-y-1">{children}</div>
      </div>
    </div>,
    document.body
  );
}

function ConfirmDialog({ title, body, confirmLabel, danger, onCancel, onConfirm }) {
  return (
    <DialogShell title={title} onCancel={onCancel}>
      <p>{body}</p>
      <div className="flex gap-2 justify-end pt-4">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-xs glass-subtle text-muted hover:text-main transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className={`px-4 py-2 rounded-lg text-xs transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none ${
            danger
              ? "bg-red-600/80 hover:bg-red-600 text-white"
              : "bg-accent/25 hover:bg-accent/40 text-main border border-accent/50"
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </DialogShell>
  );
}

function ResetPasswordDialog({ email, value, onChange, onCancel, onConfirm }) {
  return (
    <DialogShell title="Reset password" onCancel={onCancel}>
      <p className="mb-3">Set a new password for <strong className="text-main">{email}</strong> (min 6 characters).</p>
      <label htmlFor="reset-password" className="block text-xs font-medium text-muted mb-1">New password</label>
      <input
        id="reset-password"
        type="password"
        name="new-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onConfirm()}
        autoComplete="new-password"
        autoFocus
        className="w-full glass-input rounded-xl px-3 py-2 text-sm text-main placeholder:text-faint outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        placeholder="New password…"
      />
      <div className="flex gap-2 justify-end pt-4">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-xs glass-subtle text-muted hover:text-main transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="px-4 py-2 rounded-lg text-xs bg-accent/25 hover:bg-accent/40 text-main border border-accent/50 transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
        >
          Save
        </button>
      </div>
    </DialogShell>
  );
}