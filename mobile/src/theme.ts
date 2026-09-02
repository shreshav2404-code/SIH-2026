export const C = {
  ink: "#0f2942",
  inkSoft: "#4a6580",
  line: "#dbe4ed",
  bg: "#f4f7fa",
  panel: "#ffffff",
  accent: "#14539a",
  ok: "#17734a",
  okBg: "#e6f4ec",
  warn: "#9a5c00",
  warnBg: "#fdf3e2",
  crit: "#b3261e",
  critBg: "#fdecea",
  header: "#12314f",
} as const;

export const mono =
  // Clause refs read as citations, not UI chrome.
  { fontFamily: "monospace" as const, fontSize: 11, color: C.accent };
