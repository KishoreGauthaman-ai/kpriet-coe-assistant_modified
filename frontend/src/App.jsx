import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage.jsx";
import StudentPortal from "./pages/StudentPortal.jsx";
import AdminPortal from "./pages/AdminPortal.jsx";
import { AuthContext, useAuth } from "./lib/auth.js";
import { loadSettings, applySettings, DEFAULT_SETTINGS } from "./lib/settings.js";
import { getMe } from "./lib/api.js";

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const role = localStorage.getItem("role");
    const name = localStorage.getItem("name");
    if (!token || !role) {
      applySettings(loadSettings());
      setReady(true);
      return;
    }
    // Rehydrate from the server so role/name reflect the live DB (e.g. a
    // pending user approved by an admin) rather than the stale local copy.
    setUser({ token, role, name, email: localStorage.getItem("email") });
    getMe()
      .then((me) => {
        localStorage.setItem("role", me.role);
        localStorage.setItem("name", me.name);
        localStorage.setItem("email", me.email);
        setUser({ token, role: me.role, name: me.name, email: me.email });
      })
      .catch(() => {
        // Token invalid/expired or account removed — clear and send to login.
        localStorage.removeItem("token");
        localStorage.removeItem("role");
        localStorage.removeItem("name");
        localStorage.removeItem("email");
        setUser(null);
      })
      .finally(() => setReady(true));
    applySettings(loadSettings());
  }, []);

  const handleLogin = (data) => {
    // Email is stored by LoginPage before doLogin is invoked.
    setUser({ token: data.access_token, role: data.role, name: data.name, email: data.email });
    applySettings(loadSettings());
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("name");
    localStorage.removeItem("email");
    setUser(null);
    // Login page must always be default dark & purple — restore before redirect.
    applySettings(DEFAULT_SETTINGS);
  };

  return (
    <AuthContext.Provider value={{ user, login: handleLogin, logout, ready }}>
      {children}
    </AuthContext.Provider>
  );
}

function ProtectedRoute({ children, allowRoles }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (allowRoles && !allowRoles.includes(user.role)) {
    // Handle pending users - redirect to login with message or student page with notice
    if (user.role === "pending") {
      return <Navigate to="/student" replace />;
    }
    const fallback = user.role === "admin" ? "/admin" : "/student";
    return <Navigate to={fallback} replace />;
  }
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/student"
            element={
              <ProtectedRoute allowRoles={["student", "faculty", "admin", "pending"]}>
                <StudentPortal />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowRoles={["admin"]}>
                <AdminPortal />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}