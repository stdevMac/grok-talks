#!/usr/bin/env node
/**
 * Capture desktop + mobile PNGs of a URL or local HTML file.
 * Pixels first. Source-only critique is not visual QA.
 *
 * Usage: node scripts/visual-shot.mjs <url-or-file> [--out <dir>]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];

export function parseArgs(argv) {
  const copy = [...argv];
  let out;
  const flag = copy.indexOf("--out");
  if (flag >= 0) {
    out = copy[flag + 1];
    copy.splice(flag, 2);
  }
  const target = copy[0] ?? "";
  return { target, out };
}

export function resolveTarget(target, cwd = process.cwd()) {
  const trimmed = target.trim();
  if (!trimmed) throw new Error("usage: visual-shot <url-or-file> [--out <dir>]");
  if (/^https?:\/\//i.test(trimmed) || /^file:/i.test(trimmed)) return trimmed;
  const abs = path.resolve(cwd, trimmed);
  if (!fs.existsSync(abs)) throw new Error(`not found: ${abs}`);
  return pathToFileURL(abs).href;
}

export function defaultOutDir(cwd = process.cwd()) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(cwd, ".grok", "visual-qa", stamp);
}

function chromeBin() {
  const env = process.env.GROK_TALKS_CHROME;
  if (env && fs.existsSync(env)) return env;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((p) => fs.existsSync(p));
}

async function shotWithPlaywright(url, outDir) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return false;
  }
  const browser = await chromium.launch({ headless: true });
  try {
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
      });
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      const dest = path.join(outDir, `${vp.name}.png`);
      await page.screenshot({ path: dest, fullPage: true });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return true;
}

function shotWithChrome(url, outDir) {
  const bin = chromeBin();
  if (!bin) return false;
  for (const vp of VIEWPORTS) {
    const dest = path.join(outDir, `${vp.name}.png`);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "talks-chrome-"));
    const shot = path.join(tmpDir, "screenshot.png");
    const r = spawnSync(
      bin,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        `--window-size=${vp.width},${vp.height}`,
        `--screenshot=${shot}`,
        url,
      ],
      { encoding: "utf8" },
    );
    if (r.status !== 0 || !fs.existsSync(shot)) {
      throw new Error(r.stderr?.trim() || `chrome failed for ${vp.name}`);
    }
    fs.copyFileSync(shot, dest);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return true;
}

export async function capture(target, opts = {}) {
  const url = resolveTarget(target, opts.cwd);
  const outDir = path.resolve(opts.cwd ?? process.cwd(), opts.out || defaultOutDir(opts.cwd));
  fs.mkdirSync(outDir, { recursive: true });
  const ok = (await shotWithPlaywright(url, outDir)) || shotWithChrome(url, outDir);
  if (!ok) {
    throw new Error(
      "no renderer: npm install && npx playwright install chromium  (or install Google Chrome)",
    );
  }
  return VIEWPORTS.map((vp) => {
    const file = path.join(outDir, `${vp.name}.png`);
    const st = fs.statSync(file);
    if (st.size < 100) throw new Error(`empty shot ${file}`);
    return { name: vp.name, file, width: vp.width, height: vp.height, bytes: st.size };
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { target, out } = parseArgs(process.argv.slice(2));
  capture(target, { out })
    .then((rows) => {
      for (const r of rows) process.stdout.write(`${r.name}\t${r.file}\t${r.width}x${r.height}\t${r.bytes}\n`);
    })
    .catch((err) => {
      process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n");
      process.exit(1);
    });
}
