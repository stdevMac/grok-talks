import type { RoleContribution } from "./contributions.js";
import { WORDMARK } from "./contributions.js";

export function stitchLantern(contributions: RoleContribution[]): string {
  const byRole = Object.fromEntries(contributions.map((c) => [c.role, c]));
  const palette = byRole.validator?.artifact ?? "#5ce1e6";
  const motion = byRole.backend?.artifact ?? "pulse 2.4s ease-in-out infinite";
  const glitch = byRole.adversarial?.artifact ?? "off";
  const csp = byRole.security?.artifact ?? "default-src 'none'; style-src 'unsafe-inline'";
  const copy = byRole.frontend?.artifact ?? WORDMARK;
  const brief = byRole.planner?.artifact ?? "A coworker neon sign.";
  const research = byRole.explorer?.artifact ?? "Dark room, one lamp.";
  const qa = byRole.qa?.artifact ?? "roles>=2";

  const credits = contributions
    .map((c) => `<li data-role="${escapeHtml(c.role)}"><b>${escapeHtml(c.role)}</b> — ${escapeHtml(c.note)}</li>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(copy)}</title>
  <style>
    :root { color-scheme: dark; --neon: ${escapeHtml(palette)}; --void: #07070c; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      background:
        radial-gradient(1200px 500px at 50% 120%, color-mix(in oklab, var(--neon) 18%, transparent), transparent),
        var(--void);
      color: #e8e8ef; font-family: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
    }
    .sign {
      text-align: center; padding: 8vh 6vw;
    }
    h1 {
      margin: 0; font-size: clamp(3rem, 12vw, 8rem); letter-spacing: 0.12em;
      font-weight: 700; color: var(--neon);
      text-shadow:
        0 0 8px var(--neon),
        0 0 32px var(--neon),
        0 0 80px color-mix(in oklab, var(--neon) 70%, #000);
      animation: ${escapeHtml(motion)};
      ${glitch === "on" ? "filter: drop-shadow(2px 0 #ff2bd6) drop-shadow(-2px 0 #2bfff7);" : ""}
    }
    p.brief { opacity: 0.7; max-width: 36rem; margin: 1.5rem auto 0; line-height: 1.5; }
    p.research { opacity: 0.45; font-size: 0.85rem; }
    ul { text-align: left; max-width: 36rem; margin: 2.5rem auto 0; padding: 0; list-style: none; }
    li { border-top: 1px solid color-mix(in oklab, var(--neon) 25%, transparent); padding: 0.6rem 0; font-size: 0.92rem; }
    @keyframes pulse {
      0%, 100% { opacity: 0.78; }
      50% { opacity: 1; }
    }
  </style>
</head>
<body>
  <main class="sign">
    <h1>${escapeHtml(copy)}</h1>
    <p class="brief">${escapeHtml(brief)}</p>
    <p class="research">${escapeHtml(research)}</p>
    <ul>${credits}</ul>
    <p class="research" data-qa="${escapeHtml(qa)}">qa: ${escapeHtml(qa)}</p>
  </main>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
