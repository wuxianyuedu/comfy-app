// @ts-nocheck -- 一次性修复脚本:按 tsc TS2307 输出自动探测断链 import 的正确深度
/**
 * 用法:node scripts/repair-imports.cjs [--apply]
 * 每轮:跑 tsc --noEmit → 解析 TS2307(file, line, module)→ 对每个断链 spec
 * 尝试候选(原样 / 减一层 ../ / 加一层 ../ / 减两层)→ 取磁盘上真实存在的那个
 * → 重写。最多 4 轮或全部收敛。另含两类畸形字面量修复(studio/undefined、@//)。
 */
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const apply = process.argv.includes("--apply");
const exts = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
const exists = (abs) => exts.some((e) => fs.existsSync(abs + e));

const SYMBOL_MAP = {
  FilmStudio: "FilmStudio",
  ProjectCanvas: "ProjectCanvas",
  useToast: "ToastProvider",
  SourceModal: "SourceModal",
  ModelTagManager: "ModelTagManager",
};

function fixLiteralForms() {
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name).replace(/\\/g, "/");
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|mjs|cjs|js)$/.test(e.name)) files.push(p);
    }
  })("src");
  let n = 0;
  for (const f of files) {
    const file = f.replace(/\\/g, "/");
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    let out = src;
    // studio/undefined → 按导入符号映射
    out = out.replace(/import \{ ([^}]+) \} from "@\/components\/studio\/undefined";/g,
      (m, sym) => {
        const target = SYMBOL_MAP[sym.trim()];
        if (!target) return m;
    const rel = path.posix.relative(path.posix.dirname(file), "src/components/studio/" + target);
        return 'import { ' + sym + ' } from "' + (rel.startsWith(".") ? rel : "./" + rel) + '";';
      });
    // @// 畸形 → @/components/studio/
    out = out.split('"@//').join('"@/components/studio/');
    if (out !== src) { if (apply) fs.writeFileSync(file, out); n++; }
  }
  return n;
}

function fixDynamicUndefined() {
  // workspace/page 的动态 import:按 mod.X 推断
  const f = "src/app/workspace/page.tsx";
  if (!fs.existsSync(f)) return 0;
  const src = fs.readFileSync(f, "utf8");
  const out = src.replace(/import\("@\/components\/studio\/undefined"\)\.then\(\(mod\) => mod\.(\w+)\)/g,
    (m, sym) => 'import("@/components/studio/' + sym + '").then((mod) => mod.' + sym + ')');
  if (out !== src) { if (apply) fs.writeFileSync(f, out); return 1; }
  return 0;
}

function parseAndFixDepth() {
  let out;
  try {
    out = execSync("pnpm exec tsc --noEmit", { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    out = String(e.stdout || "");
  }
  const errs = [...out.matchAll(/^(.+?)\((\d+),\d+\): error TS2307: Cannot find module '([^']+)'/gm)];
  if (!errs.length) return { broken: 0, fixed: 0 };
  // 按 file+spec 去重;记录行号以定位该行文本
  const byFile = new Map();
  for (const [, file, line, mod] of errs) {
    const k = file;
    if (!byFile.has(k)) byFile.set(k, []);
    byFile.get(k).push({ line: Number(line), mod });
  }
  let fixed = 0;
  for (const [file, list] of byFile) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    let touched = false;
    for (const { line, mod } of list) {
      const idx = line - 1;
      if (!lines[idx] || !lines[idx].includes(mod)) continue;
      // 沿该行找 spec 出现位置,尝试候选深度
      const depth = (mod.startsWith("../") ? mod.match(/\.\.\//g).length : 0);
      const tail = mod.replace(/^(\.\.\/)+/, "");
      const candidates = [];
      for (const d of [depth, depth - 1, depth - 2, depth + 1]) {
        if (d < 0) continue;
        candidates.push("../".repeat(d) + tail);
      }
      if (mod.startsWith("@/")) {
        // 别名残缺(如 @//x 或 @/components/studio/undefined)已由字面量步骤处理
        candidates.push(mod.replace(/^@\//, "@/components/"));
      }
      const curDir = path.posix.dirname(file);
      for (const cand of candidates) {
        const abs = cand.startsWith("@/")
          ? path.posix.normalize(cand.replace(/^@\//, "src/"))
          : path.posix.normalize(path.posix.join(curDir, cand));
        if (exists(abs)) {
          if (cand !== mod) {
            lines[idx] = lines[idx].split('"' + mod + '"').join('"' + cand + '"');
            touched = true;
          }
          break;
        }
      }
    }
    if (touched && apply) fs.writeFileSync(file, lines.join("\n"));
    if (touched) fixed++;
  }
  return { broken: errs.length, fixed };
}

const a = fixLiteralForms();
const b = fixDynamicUndefined();
const r = parseAndFixDepth();
console.log("字面量修复:", a + b, "文件;断链:", r.broken, "→ 深度修复文件:", r.fixed);
