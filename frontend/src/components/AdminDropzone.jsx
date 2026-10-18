import { useState, useRef, useCallback } from "react";
import { FileUp } from "lucide-react";
import { ingestFile } from "../lib/api.js";

const ALLOWED = [".pdf", ".docx", ".doc", ".csv", ".xlsx", ".xls", ".txt", ".md", ".html"];

export default function AdminDropzone({ onSuccess }) {
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) validateAndUpload(f);
  }, [onSuccess]);

  const handleFile = (e) => {
    const f = e.target?.files?.[0];
    if (f) validateAndUpload(f);
  };

  const validateAndUpload = (file) => {
    const ext = "." + file.name.split(".").pop().toLowerCase();
    if (!ALLOWED.includes(ext)) {
      setError("Only PDF, DOCX, DOC, CSV, Excel, TXT, MD and HTML files are allowed");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError("File exceeds 50 MB limit");
      return;
    }
    setError(null);
    setUploading(true);
    setProgress(0);
    ingestFile(file, (pct) => setProgress(pct))
      .then((res) => {
        setProgress(100);
        onSuccess?.(res);
        setTimeout(() => { setUploading(false); setProgress(0); setError(null); }, 3000);
      })
      .catch((err) => {
        setError(err?.response?.data?.detail || err.message || "Upload failed");
        setUploading(false);
      });
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`glass-card border-2 border-dashed rounded-2xl px-6 py-10 text-center cursor-pointer transition-[border-color,background-color] w-full
          ${drag ? "border-accent bg-accent/10" : "border-white/15 hover:border-accent/50"}
          ${uploading ? "pointer-events-none opacity-60" : ""}
          focus-visible:ring-2 focus-visible:ring-accent/60 outline-none
        `}
      >
        <FileUp size={24} className="mx-auto mb-2 text-accent-soft" aria-hidden="true" />
        <p className="text-sm text-[#d1d5db]">
          Drag & drop a PDF, DOCX, DOC, CSV, Excel, TXT, MD or HTML file here, or <span className="text-accent-reasoning-on underline">browse</span>
        </p>
        <p className="text-xs text-[#4b5563] mt-1">Up to 50 MB — indexed into the RAG knowledge base</p>
        <input
          ref={fileRef}
          type="file"
          name="file"
          accept=".pdf,.docx,.doc,.csv,.xlsx,.xls,.txt,.md,.html"
          onChange={handleFile}
          className="sr-only"
          aria-label="Upload a document to the knowledge base"
        />
      </button>

      {uploading && (
        <div className="glass-subtle rounded-xl p-3" role="status" aria-live="polite">
          <p className="text-xs text-[#a78bfa] mb-1">Ingesting document&hellip;</p>
          <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-accent to-accent-soft transition-[width] duration-300 rounded-full" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-[10px] text-[#6b7280] mt-1">{progress}%</p>
        </div>
      )}

      {error && (
        <div role="alert" aria-live="polite" className="bg-red-900/20 border border-red-800 rounded-lg px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
