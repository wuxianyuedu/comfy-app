/**
 * film-studio-shot.mjs — Playwright screenshot + DOM assertion for FilmStudio
 *
 * Usage: node scripts/film-studio-shot.mjs
 * Requires: playwright (node_modules), system Chrome
 */
import { chromium } from "playwright";
import { join } from "path";

const OUT_DIR = join(process.cwd(), ".local-tmp");
const URL = "http://localhost:3000/workspace?tab=film";
const SCREENSHOT = join(OUT_DIR, "film-studio.png");

const browser = await chromium.launch({
  executablePath: "C:\\Users\\yuedu\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: [
    "--no-sandbox",
    "--no-proxy-server",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-extensions",
  ],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });

const errors = [];
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`[console] ${m.text()}`);
});

console.log(`Loading ${URL} ...`);
const resp = await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
console.log(`HTTP ${resp.status()}`);

// Wait for key visual elements to render
await page.waitForTimeout(1500);

/* ── DOM Assertions ── */
const out = {};

// 1. Aurora background blobs
out.auroraBlobs = await page.evaluate(() => {
  const blobs = document.querySelectorAll('[class*="rounded-full"][class*="mix-blend-screen"]');
  return blobs.length >= 2 ? `${blobs.length} aurora blobs found` : `only ${blobs.length} blobs`;
});

// 2. Top toolbar with project name
out.toolbarTitle = await page.evaluate(() => {
  const el = document.querySelector('header');
  if (!el) return "NO HEADER";
  return el.textContent.includes("未命名成片") ? "toolbar title OK" : `title text: ${el.textContent.slice(0, 40)}`;
});

// 3. Shot list panel (left sidebar)
out.shotListHeader = await page.evaluate(() => {
  const headers = [...document.querySelectorAll('*')].filter(
    (el) => el.textContent.trim().startsWith("分镜列表") && el.children.length < 5
  );
  return headers.length > 0 ? `shot list header: "${headers[0].textContent.trim().slice(0, 20)}"` : "NO SHOT LIST HEADER";
});

// 4. Shot items count
out.shotCount = await page.evaluate(() => {
  const shots = [...document.querySelectorAll('*')].filter(
    (el) => el.textContent.includes("开场 · 城市全景") && el.offsetHeight < 100
  );
  return `${shots.length} shot item(s) with expected content`;
});

// 5. Add shot button (+)
out.addShotBtn = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].filter(
    (b) => b.textContent.trim() === "+" || b.title?.includes("新增")
  );
  return btns.length > 0 ? `+ button found (${btns.length})` : "NO + BUTTON";
});

// 6. Preview canvas with play overlay
out.previewCanvas = await page.evaluate(() => {
  const canvases = [...document.querySelectorAll('[class*="rounded-2xl"]')].filter(
    (el) => el.querySelector('button[title*="播放"], button[title*="暂停"]')
  );
  return canvases.length > 0 ? "preview canvas with play button OK" : "NO PREVIEW CANVAS";
});

// 7. Timeline tracks
out.timelineTracks = await page.evaluate(() => {
  const trackLabels = ["视频轨", "字幕轨", "BGM"];
  const found = trackLabels.filter((l) => document.body.textContent.includes(l));
  return `${found.length}/${trackLabels.length} timeline tracks visible`;
});

// 8. Properties panel (right side)
out.propsPanel = await page.evaluate(() => {
  const labels = ["镜头名称", "时长", "生成模式", "转场效果"];
  const found = labels.filter((l) => document.body.textContent.includes(l));
  return `${found.length}/${labels.length} property fields visible`;
});

// 9. Status bar
out.statusBar = await page.evaluate(() => {
  return document.body.textContent.includes("ComfyUI 本地已连接")
    ? "status bar OK"
    : "NO STATUS BAR";
});

// 10. Status bar not overlapping (check it's at bottom)
out.statusBarPosition = await page.evaluate(() => {
  const footer = document.querySelector('footer');
  if (!footer) return "NO FOOTER ELEMENT";
  const rect = footer.getBoundingClientRect();
  const winH = window.innerHeight;
  // Footer should be at the very bottom (within 30px of window height)
  const atBottom = Math.abs(rect.bottom - winH) < 35;
  return `footer y=${rect.y.toFixed(0)} h=${rect.height.toFixed(0)} bottom=${rect.bottom.toFixed(0)} winH=${winH} → ${atBottom ? "NOT OVERLAPPING" : "MAY OVERLAP"}`;
});

// ── Print results ──
console.log("\n=== FILM STUDIO VERIFY ===");
let pass = 0;
let fail = 0;
for (const [k, v] of Object.entries(out)) {
  const ok = !v.toString().includes("NO ") && !v.toString().includes("only 0") && !v.toString().includes("MAY OVERLAP");
  console.log(`  ${ok ? "✓" : "✗"} ${k}: ${v}`);
  if (ok) pass++; else fail++;
}
console.log(`\n${pass}/${pass + fail} checks passed`);

if (errors.length) {
  console.log("\n=== ERRORS ===");
  errors.forEach((e) => console.log(`  ${e}`));
}

// ── Screenshot ──
await page.screenshot({ path: SCREENSHOT, fullPage: false });
console.log(`\nScreenshot saved: ${SCREENSHOT}`);

await browser.close();
process.exit(fail > 0 ? 1 : 0);
