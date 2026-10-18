import { Brain } from "lucide-react";

export default function ReasoningToggle({ enabled, onChange }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      aria-pressed={enabled}
      aria-label={`Reasoning mode ${enabled ? "on" : "off"}`}
      className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium
        transition-[background-color,border-color,color] duration-150 select-none cursor-pointer border
        focus-visible:ring-2 focus-visible:ring-accent/60 outline-none
        ${enabled
          ? "bg-accent/25 border-accent/60 text-accent-reasoning-on"
          : "glass-subtle text-muted hover:border-accent/40"
        }`}>
      <Brain size={16} aria-hidden="true" className={enabled ? "text-accent-reasoning-on" : "text-faint"} />
      <span className="text-sm font-bold">Reasoning</span>
    </button>
  );
}