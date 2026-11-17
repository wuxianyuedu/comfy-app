import { NextResponse } from "next/server";
import type fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { toDisplayPath } from "~/lib/path-display";

/* 运行期「本地更新」检测：桌面壳开着时前端源码 src/ 由 dev server HMR 热更、无需打扰，但有一批「改完当前窗口不生效、得重启」的文件 —— Rust 源码 / tauri.conf.json /
 * splash.html 需重编壳再重启，.env / pnpm 配置 / package.json / lockfile 需重启 dev server（startup-hotreload.md §2 第 2 列）。本路由被前端轮询：首次请求时扫描成基线
 *（模块级单例，近似 dev server 启动时刻），之后每次 GET 与当前扫描比对，回报「哪一组、具体哪些文件」在运行期被改过，前端据此弹安静的应用内提示。 */

/** 改完需「重编壳」才生效：编译期内嵌进二进制的源与配置。 */
const RECOMPILE_ROOTS: Array<string> = ["src-tauri", "tauri.conf.json", "public/splash.html"];
/** 改完需「重启 dev server」才生效：运行期由 dev server / 启动器读取。 */
const RESTART_ROOTS: Array<string> = [
  ".env",
  "pnpm-workspace.yaml",
  "package.json",
  "pnpm-lock.yaml",
];
/** 递归时跳过的目录：编译产物 / 依赖，改动不应算「源码更新」。 */
const SKIP_DIRS = new Set(["target", "node_modules", ".next"]);
const REPO_ROOT = process.cwd();

type FileFingerprint = string;

async function fingerprintOf(abs: string): Promise<FileFingerprint | null> {
  try {
    const st = await fsp.stat(abs);
    if (!st.isFile()) {
      return null;
    }
    return `${Math.trunc(st.mtimeMs)}:${st.size}`;
  } catch {
    return null;
  }
}

/** 递归收集目录下的文件绝对路径。
 *
 *  全程 `fs.promises`（ISSUE #4203）：本路由被前端每 30s 轮询，`src-tauri/` 的
 *  文件数随仓库增长——同步 `readdirSync`/`statSync` 的每一次都是对单事件循环的
 *  直接占用，异步版走线程池，不再阻塞包括探活在内的其它请求。子目录并发展开
 *  （等待全部落定后按序拼回），循环体里不留 `await`。 */
async function walkFiles(dirAbs: string): Promise<Array<string>> {
  let entries: Array<fs.Dirent>;
  try {
    entries = await fsp.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(
    entries.map(async (e) => {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) {
          return [];
        }
        return walkFiles(path.join(dirAbs, e.name));
      }
      return e.isFile() ? [path.join(dirAbs, e.name)] : [];
    }),
  );
  const out: Array<string> = [];
  for (const part of nested) {
    out.push(...part);
  }
  return out;
}

/** 单个根（文件或目录）展开成 { 相对路径 → 指纹 }；文件的指纹并发取。 */
async function collectRoot(rel: string): Promise<Map<string, FileFingerprint>> {
  const map = new Map<string, FileFingerprint>();
  const abs = path.join(REPO_ROOT, rel);
  let st: fs.Stats;
  try {
    st = await fsp.stat(abs);
  } catch {
    map.set(rel, "missing");
    return map;
  }
  if (!st.isDirectory()) {
    map.set(rel, (await fingerprintOf(abs)) ?? "missing");
    return map;
  }
  const files = await walkFiles(abs);
  const fingerprints = await Promise.all(files.map((f) => fingerprintOf(f)));
  for (const [i, f] of files.entries()) {
    const fp = fingerprints.at(i);
    map.set(toDisplayPath(f, REPO_ROOT), fp ?? "missing");
  }
  return map;
}

/** 把一组根（文件或目录）展开成 { 相对路径 → 指纹 }。根的数量是个位数、彼此
 *  无依赖，并发收集后按声明顺序并回一张表。 */
async function collectGroup(roots: Array<string>): Promise<Map<string, FileFingerprint>> {
  const maps = await Promise.all(roots.map((rel) => collectRoot(rel)));
  const map = new Map<string, FileFingerprint>();
  for (const part of maps) {
    for (const [rel, fp] of part) {
      map.set(rel, fp);
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

async function diffGroup(
  roots: Array<string>,
  base: Map<string, FileFingerprint> | undefined,
): Promise<{ dirty: boolean; files: Array<string> }> {
  const current = await collectGroup(roots);
  // 还没有基线：记录当前态作为以后比对参照，本轮视为「无变化」。
  if (!base) {
    return { dirty: false, files: [] };
  }
  const files: Array<string> = [];
  for (const [rel, fp] of current) {
    if (base.get(rel) !== fp) {
      files.push(rel);
    }
  }
  // 基线里存在、本次已被删除的文件也纳入
  for (const rel of base.keys()) {
    if (!current.has(rel)) {
      files.push(rel);
    }
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
      ...(await diffGroup(RESTART_ROOTS, currentBaseline?.restart)),
    },
    {
      key: "recompile",
      label: "重编壳生效",
      hint: "需重编壳后重启才生效（cargo build --release --features custom-protocol）",
      ...(await diffGroup(RECOMPILE_ROOTS, currentBaseline?.recompile)),
    },
  ];

  // 尚未有基线时（首次请求）先定格基线，本次不当作「检测到更新」。
  if (!currentBaseline) {
    baseline = {
      recompile: await collectGroup(RECOMPILE_ROOTS),
      restart: await collectGroup(RESTART_ROOTS),
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
