import { useState, useRef, useCallback, useEffect } from "react";
import { transcribeVoice } from "../lib/api.js";
import ReasoningToggle from "./ReasoningToggle.jsx";

function MicIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
      <path d="M19 11v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

const MAX_HEIGHT = 72;
const MIN_HEIGHT = 44;

export default function InputBar({ reasoning, onToggle, onSend, onStop, streaming, disabled }) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [textareaHeight, setTextareaHeight] = useState(MIN_HEIGHT);
  const mediaRecorder = useRef(null);
  const chunks = useRef([]);
  const textareaRef = useRef(null);

  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const scrollH = ta.scrollHeight;
    const newH = Math.min(Math.max(scrollH, MIN_HEIGHT), MAX_HEIGHT);
    ta.style.height = newH + "px";
    setTextareaHeight(newH);
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [text, adjustHeight]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = MIN_HEIGHT + "px";
      setTextareaHeight(MIN_HEIGHT);
    }
  }, [text, disabled, onSend]);

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (streaming) {
        onStop?.();
      } else {
        handleSend();
      }
    }
  };

  const handleInput = (e) => {
    setText(e.target.value);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunks.current = [];
      mediaRecorder.current.ondataavailable = (ev) => {
        if (ev.data.size) chunks.current.push(ev.data);
      };
      mediaRecorder.current.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        if (!blob.size) return;
        setTranscribing(true);
        try {
          const res = await transcribeVoice(blob);
          setText((p) => (p.trim() ? p + " " : "") + res.text);
        } catch (err) {
          console.warn("Voice transcribe failed", err);
        } finally {
          setTranscribing(false);
        }
      };
      mediaRecorder.current.start();
      setRecording(true);
    } catch (_) {
      console.warn("Microphone access denied");
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current?.state === "recording") {
      mediaRecorder.current.stop();
      setRecording(false);
    }
  };

  useEffect(() => {
    return () => {
      if (mediaRecorder.current?.state === "recording") mediaRecorder.current.stop();
      mediaRecorder.current?.stream?.getTracks?.().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="max-w-3xl mx-auto w-full px-4">
      <div className="glass-card rounded-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden">
        {/* Row 1: Textarea - full width */}
        <div className="p-4">
          <label htmlFor="message-input" className="sr-only">Message</label>
          <textarea
            id="message-input"
            ref={textareaRef}
            name="message"
            value={text}
            onChange={handleInput}
            onKeyDown={handleKey}
            placeholder="Ask about your career, courses or COE labs…"
            autoComplete="off"
            disabled={disabled}
            rows={1}
            className="w-full resize-none rounded-xl glass-input text-main placeholder:text-faint
              px-4 py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/60 transition-colors
              disabled:opacity-50 bg-transparent
              min-h-[44px] max-h-[72px] overflow-y-auto"
            style={{ height: textareaHeight + "px" }}
          />
        </div>

        {/* Row 2: Reasoning left, Mic + Send right */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/5 bg-white/5">
          <ReasoningToggle enabled={reasoning} onChange={onToggle} />

          <div className="flex items-center gap-2">
            {/* Mic Button */}
            <button
              onClick={recording ? stopRecording : startRecording}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-[transform,background-color,color,box-shadow,border-color]
                ${recording
                  ? "bg-accent text-white shadow-[0_0_0_2px_rgba(255,100,200,0.4)] scale-105"
                  : transcribing
                  ? "glass-subtle cursor-wait"
                  : "glass-subtle hover:border-accent/60 hover:bg-accent/10 text-accent"}
                disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-accent/60 outline-none`}
              disabled={disabled || transcribing}
              aria-label={recording ? "Stop recording" : "Start voice input"}
              title={recording ? "Stop recording" : "Start voice input"}
            >
              {transcribing ? (
                <span className="animate-spin inline-block w-4 h-4 border-2 border-transparent border-t-current rounded-full" />
              ) : (
                <MicIcon />
              )}
            </button>

            {/* Send / Stop Button */}
            <button
              onClick={streaming ? () => onStop?.() : handleSend}
              disabled={!streaming && (!text.trim() || disabled)}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-[background-color,color]
                ${streaming
                  ? "bg-[#ffffff] text-[#111111] hover:bg-[#f1f1f1]"
                  : "bg-accent text-white hover:bg-accent-soft"}
                disabled:opacity-30 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-accent/60 outline-none`}
              aria-label={streaming ? "Stop generating" : "Send message"}
              title={streaming ? "Stop generating" : "Send message"}
            >
              {streaming ? (
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                  <path d="M11 4.83 6.41 9.42 5 8l7-7 7 7-1.41 1.42L13 4.83V20h-2V4.83z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}