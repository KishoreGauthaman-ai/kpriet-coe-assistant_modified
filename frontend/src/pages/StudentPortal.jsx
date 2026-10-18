import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { chatStream, saveSession, loadSessions } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import Sidebar from "../components/Sidebar.jsx";
import ChatContainer from "../components/ChatContainer.jsx";
import InputBar from "../components/InputBar.jsx";

export default function StudentPortal() {
  const navigate = useNavigate();
  const { logout } = useAuth() || {};
  const [reasoning, setReasoning] = useState(false);
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [sessionsVersion, setSessionsVersion] = useState(0);
  const abortRef = useRef(null);
  const role = localStorage.getItem("role");
  const empty = messages.length === 0;

  useEffect(() => {
    if (role === "admin") navigate("/admin", { replace: true });
  }, [role, navigate]);

  // Cleanup: abort streaming on unmount or new chat to prevent memory leaks
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleSend = useCallback((text) => {
    const userMsg = { role: "user", content: text };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setStreaming(true);

    let assistantContent = "";
    let assistantMeta = null;
    const assistantMsg = { role: "assistant", content: "", meta: null };
    setMessages([...updated, assistantMsg]);

    abortRef.current?.abort();
    abortRef.current = chatStream(
      { message: text, reasoning, history: messages },
      {
        onToken: (tok) => {
          assistantContent += tok;
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = { ...next[next.length - 1], content: assistantContent };
            return next;
          });
        },
        onMeta: (data) => {
          assistantMeta = data;
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = { ...next[next.length - 1], meta: data };
            return next;
          });
        },
        onDone: () => {
          setStreaming(false);
          const title = text.length > 50 ? text.slice(0, 47) + "…" : text;
          saveSession({
            id: sessionId,
            title,
            messages: [...messages, userMsg, { role: "assistant", content: assistantContent, meta: assistantMeta }],
            timestamp: Date.now(),
          });
          setSessionsVersion((v) => v + 1);
        },
        onError: (err) => {
          setStreaming(false);
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: err, meta: null },
          ]);
        },
      }
    );
  }, [messages, reasoning, sessionId]);

  const newChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setStreaming(false);
    setSessionId(crypto.randomUUID());
    setSessionsVersion((v) => v + 1);
  };

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, []);

  const handleLogout = () => {
    abortRef.current?.abort();
    logout?.();
    navigate("/login", { replace: true });
  };

  const selectSession = (id) => {
    abortRef.current?.abort();
    const found = loadSessions().find((s) => s.id === id);
    if (!found) return;
    setSessionId(id);
    setMessages(found.messages || []);
    setStreaming(false);
  };

  useEffect(() => {
    newChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-screen flex bg-app">
      <Sidebar
        activeId={sessionId}
        onSelect={selectSession}
        onNew={newChat}
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
        refreshKey={sessionsVersion}
      />
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Logout button top right */}
        <div className="absolute top-4 right-4 z-30">
          <button
            onClick={handleLogout}
            className="glass-subtle text-muted hover:text-red-400 hover:border-red-500/40 rounded-full px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
            title="Logout"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
            Logout
          </button>
        </div>

        <main className="flex-1 flex flex-col min-h-0">
          <div
            className="flex-1 min-h-0 flex flex-col w-full"
            style={{ justifyContent: empty ? "center" : "flex-end" }}
          >
            <ChatContainer messages={messages} streaming={streaming} empty={empty} />
            {empty && <div style={{ marginTop: "1.5rem", width: "100%" }} />}
            <InputBar
              reasoning={reasoning}
              onToggle={(val) => setReasoning(val)}
              onSend={handleSend}
              onStop={stopStreaming}
              streaming={streaming}
              disabled={streaming}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
