import { useState, useEffect, useCallback } from "react";
import { Menu, Plus, Trash2, X } from "lucide-react";
import { loadSessions, deleteSession } from "../lib/api.js";
import ProfilePanel from "./ProfilePanel.jsx";

export default function Sidebar({ activeId, onSelect, onNew, collapsed, onToggle, refreshKey }) {
  const [sessions, setSessions] = useState([]);

  const reload = useCallback(() => {
    setSessions(loadSessions());
  }, []);

  useEffect(() => {
    reload();
  }, [reload, activeId, refreshKey]);

  const handleDelete = useCallback(
    (id) => {
      deleteSession(id);
      reload();
    },
    [reload]
  );

  return (
    <>
      {/* Collapse toggle (mobile) */}
      <button
        onClick={onToggle}
        className="lg:hidden fixed top-3 left-3 z-50 w-9 h-9 rounded-full glass-subtle flex items-center justify-center text-sm focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
        aria-label={collapsed ? "Open sidebar" : "Close sidebar"}
      >
        {collapsed ? <Menu size={16} aria-hidden="true" /> : <X size={16} aria-hidden="true" />}
      </button>

      <aside
        className={`fixed lg:relative z-40 top-0 left-0 h-full w-80 bg-inside glass-card border-r border-app
          transition-transform duration-300 flex flex-col
          ${collapsed ? "-translate-x-full lg:translate-x-0 lg:w-20" : "translate-x-0"}`}
      >
        {/* Header */}
        <div className="px-4 py-4 border-b border-app flex items-center justify-between">
          {!collapsed && <span className="text-sm font-semibold text-accent-soft">Chat History</span>}
          <button
            onClick={onNew}
            className="shrink-0 w-9 h-9 rounded-xl glass-subtle hover:bg-accent/15 hover:border-accent/50 flex items-center justify-center text-lg text-main transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
            aria-label="New chat"
            title="New chat"
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Session list */}
        <div className={`flex-1 overflow-y-auto py-2 ${collapsed ? "px-1" : ""}`}>
          {!collapsed && sessions.length > 0 && (
            <>
              {sessions.map((s) => (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(s.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(s.id); } }}
                  className={`group flex items-center justify-between px-3 py-2.5 mx-2 my-1.5 rounded-xl text-sm text-left cursor-pointer transition-colors w-[calc(100%-1rem)] focus-visible:ring-2 focus-visible:ring-accent/60 outline-none
                    ${activeId === s.id ? "bg-accent/20 text-accent-reasoning-on border border-accent/30" : "text-muted hover:bg-white/5 border border-transparent"}
                  `}
                >
                  <span className="truncate flex-1 text-xs">{s.title || "New Chat"}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                    className="ml-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-[#838] hover:text-red-400 text-xs transition-opacity cursor-pointer focus-visible:ring-2 focus-visible:ring-accent/60 outline-none"
                    aria-label={`Delete chat ${s.title || "New Chat"}`}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </>
          )}

          {collapsed && sessions.length > 0 && (
            <>
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onSelect(s.id)}
                  title={s.title || "New Chat"}
                  aria-label={`Open chat ${s.title || "New Chat"}`}
                  className={`w-9 h-9 mx-auto my-1.5 rounded-full flex items-center justify-center text-xs cursor-pointer
                    ${activeId === s.id ? "bg-accent/20 text-accent-soft border border-accent/50" : "glass-subtle text-muted hover:border-accent/40"}
                  `}
                >
                  {s.title?.[0]?.toUpperCase() || ">"}
                </button>
              ))}
            </>
          )}

          {sessions.length === 0 && !collapsed && (
            <p className="text-xs text-faint px-4 py-6 text-center">No sessions yet</p>
          )}
        </div>

        {/* Profile + Settings */}
        <ProfilePanel collapsed={collapsed} />
      </aside>
    </>
  );
}
