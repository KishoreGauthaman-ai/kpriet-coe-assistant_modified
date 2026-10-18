import { useState, useEffect, useCallback } from "react";

const SETTINGS_KEY = "kpriet_coe_settings";

export const ACCENT_COLORS = [
  { id: "violet", value: "#7c3aed", soft: "#8b5cf6" },
  { id: "blue", value: "#3b82f6", soft: "#60a5fa" },
  { id: "green", value: "#10b981", soft: "#34d399" },
  { id: "pink", value: "#ec4899", soft: "#f472b6" },
  { id: "orange", value: "#f59e0b", soft: "#fbbf24" },
];

export const DEFAULT_SETTINGS = { theme: "dark", accent: "violet" };

export const getCurrentUserKey = () =>
  localStorage.getItem("email") || localStorage.getItem("name") || "guest";

const settingsKey = () => `${SETTINGS_KEY}_${getCurrentUserKey()}`;

export const loadSettings = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(settingsKey()) || "{}");
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

export const saveSettings = (patch) => {
  const next = { ...loadSettings(), ...patch };
  localStorage.setItem(settingsKey(), JSON.stringify(next));
  return next;
};

export function applySettings({ theme, accent }) {
  const doc = document.documentElement;
  doc.setAttribute("data-theme", theme === "light" ? "light" : "dark");
  const color = ACCENT_COLORS.find((a) => a.id === accent) || ACCENT_COLORS[0];
  doc.style.setProperty("--color-accent", color.value);
  doc.style.setProperty("--color-accent-soft", color.soft);
  doc.style.setProperty("--color-accent-glow", `${color.value}72`);
  doc.style.setProperty("--color-accent-reasoning-on", color.soft);
}

export function useSettings() {
  const [settings, setSettings] = useState(loadSettings);

  useEffect(() => {
    applySettings(settings);
  }, [settings]);

  const update = useCallback((patch) => {
    setSettings(saveSettings(patch));
  }, []);

  const reset = useCallback(() => {
    localStorage.removeItem(settingsKey());
    setSettings({ ...DEFAULT_SETTINGS });
  }, []);

  const accent =
    ACCENT_COLORS.find((a) => a.id === settings.accent) || ACCENT_COLORS[0];

  return { settings, update, reset, accent };
}
