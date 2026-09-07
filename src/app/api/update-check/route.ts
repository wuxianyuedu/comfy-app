import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

/* ── 运行期「本地更新」检测：需重启才生效的文件 ─────────────────
 * 桌面壳开着时，前端源码 src/ 由 dev server HMR 自动热更、无需打扰；
 * 但有一批「改完当前窗口不生效、得重启」的文件（startup-hotreload.md §2
 * 第 2 列）——Rust 源码 / tauri.conf.json / splash.html 需重编壳再重启，
 * .env / pnpm 配置 / package.json / lockfile 需重启 dev server。
 *
 * 本路由在运行期被前端轮询：首次被请求时把上述文件扫描成基线（模块级
 * 单例，近似 dev server 启动时刻），之后每次 GET 与当前扫描比对，回报
 * 「哪一组、具体哪些文件」在运行期被改过。前端据此弹安静的应用内提示。
 */

/** 改完需「重编壳」才生效：编译期内嵌进二进制的源与配置。 */
const RECOMPILE_ROOTS: string[] = [
  "src-tauri",
  "tauri.conf.json",
  "public/splash.html",
];
/** 改完需「重启 dev server」才生效：运行期由 dev server / 启动器读取。 */
const RESTART_ROOTS: string[] = [
  ".env",
  "pnpm-workspace.yaml",
  "package.json",
  "pnpm-lock.yaml",
];
/** 递归时跳过的目录：编译产物 / 依赖，改动不应算「源码更新」。 */
const SKIP_DIRS = new Set(["target", "node_modules", ".next"]);
const REPO_ROOT = process.cwd();

type FileFingerprint = string;

function fingerprintOf(abs: string): FileFingerprint | null {
  try {
    const st = fs.statSync(/*turbopackIgnore: true*/ abs);
    if (!st.isFile()) return null;
    return `${Math.trunc(st.mtimeMs)}:${st.size}`;
  } catch {
    return null;
  }
}

/** 递归收集目录下的文件绝对路径。 */
function walkFiles(dirAbs: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(/*turbopackIgnore: true*/ dirAbs, {
      withFileTypes: true,
    });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkFiles(path.join(dirAbs, e.name), out);
    } else if (e.isFile()) {
      out.push(path.join(dirAbs, e.name));
    }
  }
  return out;
}

/** 把一组根（文件或目录）展开成 { 相对路径 → 指纹 }。 */
function collectGroup(roots: string[]): Map<string, FileFingerprint> {
  const map = new Map<string, FileFingerprint>();
  for (const rel of roots) {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) {
      map.set(rel, "missing");
      continue;
    }
    const st = fs.statSync(/*turbopackIgnore: true*/ abs);
    if (st.isDirectory()) {
      for (const f of walkFiles(abs)) {
        const fp = fingerprintOf(f);
        map.set(path.relative(REPO_ROOT, f), fp ?? "missing");
      }
    } else {
      map.set(rel, fingerprintOf(abs) ?? "missing");
    }
  }
  return map;
}

/**
 * 模块级基线：首次被请求时定格为「当前文件状态」，此后任何一次改动都相对
 * 它判定（近似 dev server 启动时刻的快照，dev server 重启后基线自然重置）。
 */
let baseline: {
  recompile: Map<string, FileFingerprint>;
  restart: Map<string, FileFingerprint>;
} | null = null;

function diffGroup(
  roots: string[],
  base: Map<string, FileFingerprint> | undefined,
): { dirty: boolean; files: string[] } {
  const current = collectGroup(roots);
  // 还没有基线：记录当前态作为以后比对参照，本轮视为「无变化」。
  if (!base) return { dirty: false, files: [] };
  const files: string[] = [];
  for (const [rel, fp] of current) {
    if (base.get(rel) !== fp) files.push(rel);
  }
  // 基线里存在、本次已被删除的文件也纳入
  for (const rel of base.keys()) {
    if (!current.has(rel)) files.push(rel);
  }
  return { dirty: files.length > 0, files: files.sort() };
}

export async function GET() {
  const currentBaseline = baseline;
  const groups = [
    {
      key: "restart",
      label: "重启生效",
      hint: "需重启应用（dev server）才生效",
      ...diffGroup(RESTART_ROOTS, currentBaseline?.restart),
    },
    {
      key: "recompile",
      label: "重编壳生效",
      hint: "需重编壳后重启才生效（cargo build --release --features custom-protocol）",
      ...diffGroup(RECOMPILE_ROOTS, currentBaseline?.recompile),
    },
  ];

  // 尚未有基线时（首次请求）先定格基线，本次不当作「检测到更新」。
  if (!currentBaseline) {
    baseline = {
      recompile: collectGroup(RECOMPILE_ROOTS),
      restart: collectGroup(RESTART_ROOTS),
    };
  }

  const dirty = groups.some((g) => g.dirty);
  return NextResponse.json({
    ok: true,
    /** 基线是否已建立（首轮请求前为 false，前端据此跳过空轮询提示） */
    armed: !!currentBaseline,
    dirty,
    groups,
  });
}
