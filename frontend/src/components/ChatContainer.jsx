import { useEffect, useRef } from "react";
import { GraduationCap } from "lucide-react";
import ReactMarkdown from "react-markdown";

export default function ChatContainer({ messages, streaming, empty }) {
  const bottomRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Only auto-scroll if the user is already near the bottom (~120px); don't
    // yank them down if they scrolled up to read. Use instant scroll while
    // streaming to avoid per-token smooth-animation jank.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) {
      bottomRef.current?.scrollIntoView?.({ behavior: streaming ? "auto" : "smooth" });
    }
  }, [messages, streaming]);

  return (
    <div
      ref={scrollRef}
      className={`px-4 ${empty ? "py-2" : "py-6 flex-1 overflow-y-auto"}`}
      style={{
        flexGrow: empty ? 0 : 1,
        flexBasis: "auto",
      }}
    >
      <div className="max-w-3xl mx-auto space-y-6">
        {messages.length === 0 && (
          <div
            className="flex flex-col items-center justify-center h-64 text-faint select-none"
            style={{ opacity: empty ? 1 : 0 }}
          >
            <div className="mb-4 glass-card rounded-2xl p-6" aria-hidden="true">
              <GraduationCap size={32} className="text-accent-soft" />
            </div>
            <p className="text-sm text-muted">KPRIET Centre of Excellence Knowledge Assistant</p>
            <p className="text-xs mt-2 max-w-xs text-center">
              Ask about courses, career paths, COE lab facilities, or toggle
              <span className="text-accent-reasoning-on">&ensp;Reasoning&thinsp;</span>
              for personalised mentoring.
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            {/* Avatar */}
            <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
              ${m.role === "user"
                ? "bg-accent text-white"
                : "glass-subtle text-muted"}`}>
              {m.role === "user" ? "U" : "C"}
            </div>
            {/* Bubble */}
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
              m.role === "user"
                ? "bg-accent/20 text-main rounded-tr-md border border-accent/30 backdrop-blur-sm"
                : "glass-card text-main rounded-tl-md"
            }`}>
              {m.role === "assistant" ? (
                <ReactMarkdown className="prose prose-invert prose-sm max-w-none [&>p]:my-0.5 [&>pre]:bg-[#0b0b10] [&>pre]:rounded-lg [&>pre]:px-3 [&>pre]:py-2 [&>code]:text-xs [&_ol]:pl-5 [&_ul]:pl-5">
                  {m.content}
                </ReactMarkdown>
              ) : (
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
              )}

              {/* Sources footer when meta provides them */}
              {m.meta?.sources?.length > 0 && (
                <div className="mt-2 pt-2 border-t border-white/10 text-[10px] text-faint flex gap-2 flex-wrap">
                  {m.meta.sources.map((s, si) => (
                    <span key={si} className="glass-subtle px-1.5 py-0.5 rounded">{s.source}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Streaming typing indicator */}
        {streaming && (
          <div className="flex gap-3 animate-fade-in" role="status" aria-live="polite">
            <div className="shrink-0 w-8 h-8 rounded-full glass-subtle flex items-center justify-center text-sm font-bold text-[#e2a]">
              C
            </div>
            <div className="glass-card rounded-2xl rounded-tl-md px-4 py-3 text-sm text-accent-soft" aria-hidden="true">
              &#x25cf;&#x25cf;&#x25cf;
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
