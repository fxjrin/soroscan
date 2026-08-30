export type Theme = "light" | "dark";

/** The theme the document is rendered in right now. */
export function activeTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * Applies an explicit choice and remembers it; the pre-paint script in
 * index.html reads the same key on the next visit. Until a choice is
 * made, that script follows the system preference instead.
 */
export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // storage can be blocked; the choice still applies to this page
  }
}
