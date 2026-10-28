// ── 「pnpm 的包真身 JS 入口在哪」的唯一判据（ISSUE #2562）────────────────────
//
// 为什么单列一个模块：这一格是形态判据里**最便宜的那一档**（比经 PowerShell 宿主快
// 一个数量级），而它自己只依赖「读一个 package.json 的 `bin` 字段」+「判这个文件
// 是不是脚本」两件小事 —— 留在 `executable-resolve.ts` 里会把那个文件顶过
// 文件长度硬闸（规范 §12.6 的 R 系列文件结构规则），而这两件事本来也不是同一层的问题。
//
// 调用方只有一处：`executable-resolve.ts` 的 `pnpmInvocation()`，它把这里交出来的
// `{ command, prefixArgs }` 当作**第一优先**形态。所以本模块**不做**「这台机器上
// pnpm 到底怎么起」的完整判定（那是 `whichCommand()` / `usableCommand()` 的活），
// 只回答「这些落点上有没有一个 node 能直接起的 JS 入口」。
//
// `isFile` / `isScript` 由调用方注入，**不在这里再写一份**：判「这份文件是不是脚本」
// 的唯一实现是 `executable-resolve.ts` 的 `executableKind()`，抄一份就是孪生判据
// （硬规则 24 / §12.12）—— 而 `executable-resolve.ts` 反过来要 import 本模块（拿
// 入口路径），静态互相 import 会把依赖环写进模块图。

import fs from "node:fs";
import path from "node:path";

import { isWindows } from "./platform.ts";

/** 本模块要的两个注入面（默认值由 `executable-resolve.ts` 在调用处给）。 */
export interface PnpmEntryIo {
  /** 这个路径是不是普通文件。 */
  isFile(candidate: string): boolean;
  /** 这份文件能不能被 `process.execPath` 起（不是二进制、不是批处理）。 */
  isScript(candidate: string): boolean;
  /** 读一个环境变量（**按目标平台的大小写语义**，Windows 上 `Path` 与 `PATH` 是同一个）。 */
  envVar(
    env: NodeJS.ProcessEnv | Record<string, string | undefined>,
    name: string,
    platform: NodeJS.Platform,
  ): string | undefined;
}

/**
 * 这个落点上 pnpm 的**包真身 JS 入口**；没有就给 `null`。
 *
 * ## 为什么要这一层（ISSUE #2562）
 *
 * 本仓的 pnpm 只有两个落点真正被用到：corepack 的版本目录
 * （`%LOCALAPPDATA%\node\corepack\v1\pnpm\<ver>\`）与 pnpm 自己的落地目录
 * （`%LOCALAPPDATA%\pnpm\`）。那上面的可执行形态只有几个选择，而它们的代价差一个数量级：
 *
 *   · 无扩展名 shim —— `#!/usr/bin/env node`，libuv 不解析 shebang，**Node 起不了**；
 *   · `.cmd` / `.bat` —— 批处理只有 cmd.exe 解释，Node 起它直接 `EINVAL`
 *     （CVE-2021-22940 之后 Node 一律拒绝批处理垫片，**与 Node 版本无关**）；
 *   · 原生二进制（`pnpm.exe` / `pnpm-native.exe`）—— 起得来，但这条路上没有 Node 进程，
 *     本判据要回答的「怎么经 node 起 pnpm」在它身上没有对象；
 *   · `.ps1` 经 PowerShell 宿主 —— 起得来，但**每一条命令多付一次 PowerShell 冷启动**。
 *
 * 所以「**绕开垫片，直接跑 JS 入口**」才是这一格的最优解：`spawn(process.execPath,
 * [<包真身入口>, …])` —— `shell: false` 恒定、全平台同一条路、不需要宿主。
 *
 * ## 落点的两种形状都要接得住
 *
 *   · `<落点>/node_modules/pnpm/package.json` —— PATH 上某个条目本身就是一份安装
 *     （`npm i -g pnpm` / `pnpm-home` 那一形）；
 *   · `<落点>/package.json` —— 落点**自己**就是那个包（corepack 的
 *     `<ver>/node_modules/pnpm/`，以及 `corepack enable` 之后 PATH 上那个
 *     `…/corepack/v1/pnpm/<ver>/`）。
 * 两种都由 `pnpmPackageDir()` 一处回答，别在调用方再猜一遍。
 *
 * ## 「JS 入口在哪」不猜文件名，问包的 `bin` 字段
 *
 * `bin` 有两种合法形状：字符串（就是入口），对象（取键等于包名的那一条）。
 * 猜文件名等于替包做决定（`scripts/package-bin-entry.mjs` 那一层早就这么写了，
 * 同一件事不造第二轮子）。唯一的例外写在下面那段注释里：`bin` 指向原生二进制时，
 * 兜一层 Corepack 对 pnpm ≥ 11 写死的 `bin/pnpm.mjs`。
 *
 * @param {string} dropIn 装着 pnpm 的落点目录
 * @returns {string | null}
 */
export function pnpmJsEntry(dropIn: string, io: PnpmEntryIo): string | null {
  const pkgDir = pnpmPackageDir(dropIn, io);
  if (!pkgDir) return null;
  let manifest: { bin?: unknown };
  try {
    manifest = JSON.parse(
      fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"),
    ) as { bin?: unknown };
  } catch {
    return null;
  }
  const bin = manifest.bin;
  let rel: unknown;
  if (typeof bin === "string") rel = bin;
  else if (bin && typeof bin === "object")
    rel = (bin as Record<string, unknown>).pnpm;
  if (typeof rel === "string" && rel !== "") {
    const target = path.resolve(pkgDir, rel);
    if (io.isFile(target) && io.isScript(target)) return target;
  }
  /* `bin` 指向原生二进制时（pnpm 11+ 把 `pnpm` 写成 `{ "pnpm": "pnpm" }`，
   * 那个文件是 MZ / ELF），**同包的 Corepack 入口**在 `bin/pnpm.mjs` —— 它对
   * pnpm ≥ 11 写死这一个相对路径。名字照 Corepack 的约定抄，不是本仓替包做决定：
   * 读不到就老实返回 `null`，调用方照旧走「直接起可执行形态」那条路。 */
  for (const name of ["pnpm.mjs", "pnpm.cjs"]) {
    const corepackEntry = path.join(pkgDir, "bin", name);
    if (io.isFile(corepackEntry) && io.isScript(corepackEntry)) return corepackEntry;
  }
  return null;
}

/** 落点上那个 pnpm 包的目录（两种形状，见 {@link pnpmJsEntry} 头注）。 */
function pnpmPackageDir(dropIn: string, io: PnpmEntryIo): string | null {
  for (const dir of [path.join(dropIn, "node_modules", "pnpm"), dropIn]) {
    if (io.isFile(path.join(dir, "package.json"))) {
      /* 落点自己是包时，这份 `package.json` 可能是别的包（PATH 上随便一个目录）；
       * 名字对不上就不算。 */
      if (dir !== dropIn) return dir;
      try {
        const pkg = JSON.parse(
          fs.readFileSync(path.join(dir, "package.json"), "utf8"),
        ) as { name?: unknown };
        if (pkg.name === "pnpm") return dir;
      } catch {
        /* 读不了就跳过这一格。 */
      }
    }
  }
  return null;
}

/**
 * `pnpmInvocation()` 选形态时的**第一优先**：能跑 JS 入口时就不起垫片
 * （ISSUE #2562）。
 *
 * 候选落点按 PATH 顺序，外加 corepack 与 pnpm 自己的两个标准落点 —— 后两个是
 * 「PATH 上只有垫片、但包真身就摆在旁边」的现场（corepack enable 之后 PATH 上通常
 * 只有 `pnpm` / `pnpm.cmd` / `pnpm.ps1` 三个垫片，包真身在 corepack 的版本目录里）。
 *
 * 与 `NodeJS.Platform` 无关：全平台同一条路。POSIX 上 PATH 上的 shim 本来就是个
 * `#!/usr/bin/env node` 脚本，走 JS 入口只是**少起一层进程**（多一次 tick 的差别），
 * 行为零改动。
 *
 * @returns {{command: string, prefixArgs: string[], entry: string, candidate: string} | null}
 *          `entry` 是那个 JS 入口，`candidate` 是它所在的落点（排障用）。
 */
export function pnpmJsInvocation({
  name = "pnpm",
  env,
  platform,
  io,
}: {
  io: PnpmEntryIo;
  name?: string;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  platform: NodeJS.Platform;
}): { command: string; prefixArgs: string[]; entry: string; candidate: string } | null {
  /* 只有 pnpm 有「包真身 + 垫片」这一形；`pnpmInvocation` 的 `name` 选项还被
   * `cnb` 复用（那是 pnpm 全局安装的一个 bin，落点形状不同），所以按名字收口。 */
  if (name !== "pnpm") return null;
  const dirs = String(io.envVar(env, "PATH", platform) ?? "")
    .split(isWindows(platform) ? ";" : ":")
    .filter(Boolean);
  for (const dir of dirs) {
    const entry = pnpmJsEntry(dir, io);
    if (entry) {
      return { command: process.execPath, prefixArgs: [entry], entry, candidate: dir };
    }
  }
  /* PATH 上只有垫片：包真身在这两个标准落点上（corepack 按版本分目录，取最高的那一版）。 */
  const localAppData = String(io.envVar(env, "LOCALAPPDATA", platform) ?? "");
  const home = String(
    io.envVar(env, "USERPROFILE", platform) ?? io.envVar(env, "HOME", platform) ?? "",
  );
  const roots = [
    localAppData && path.join(localAppData, "node", "corepack", "v1", "pnpm"),
    localAppData && path.join(localAppData, "pnpm"),
    home && path.join(home, "AppData", "Local", "node", "corepack", "v1", "pnpm"),
    home && path.join(home, "AppData", "Local", "pnpm"),
    home && path.join(home, ".local", "share", "pnpm"),
    home && path.join(home, "Library", "pnpm"),
  ].filter((v): v is string => Boolean(v));
  for (const root of roots) {
    /* 先按「落点本身就是那一版」试一次，再按 corepack 的子目录（`<ver>/`）试 ——
     * 两个落点的形状不一样，两次 `readdirSync` 的代价远小于「漏掉一个落点」。 */
    const dropIns = [root];
    try {
      dropIns.push(
        ...fs
          .readdirSync(root, { withFileTypes: true })
          .filter((d) => d.isDirectory() && /^\d+\.\d+\.\d+/.test(d.name))
          .map((d) => path.join(root, d.name))
          .sort((a, b) => compareVersionDesc(path.basename(a), path.basename(b))),
      );
    } catch {
      /* 落点不存在（这台机没装 corepack / 没装 pnpm）：看下一个。 */
    }
    for (const dropIn of dropIns) {
      const entry = pnpmJsEntry(dropIn, io);
      if (entry) {
        return { command: process.execPath, prefixArgs: [entry], entry, candidate: dropIn };
      }
    }
  }
  return null;
}

/** 版本目录排序用（`12.4.1` 排在 `10.34.5` 前面）—— 非数字段按字符串退让。 */
function compareVersionDesc(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const na = Number.parseInt(pa[i] ?? "0", 10);
    const nb = Number.parseInt(pb[i] ?? "0", 10);
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      const cmp = String(pa[i] ?? "").localeCompare(String(pb[i] ?? ""));
      if (cmp !== 0) return cmp;
      continue;
    }
    if (na !== nb) return -1 * (na - nb);
  }
  return 0;
}
