#!/usr/bin/env node
/**
 * build-desktop.mjs — Tauri 桌面壳生产构建脚本
 *
 * 职责（供 tauri.conf.json 的 beforeBuildCommand 调用，随后执行 pnpm tauri build）：
 *   1) pnpm build：Next.js 输出 standalone（.next/standalone，含 server.js + 裁剪版 node_modules）
 *   2) 组装 src-tauri/static：
 *        - .next/standalone/*        → static/（server 本体）
 *        - .next/static/*            → static/.next/static（前端静态资源，standalone 不自动带）
 *        - public/*                  → 静态资源 /public
 *        - 生成 index.html（sidecar 就绪前的过渡加载页）
 *   3) 复制当前 Node 运行时为 Tauri sidecar：src-tauri/binaries/node-<target-triple>[.exe]
 *      （bundle.externalBin = ["binaries/node"]，打包后资源中按平台名为 node / node.exe）
 *
 * 产物被 src-tauri/.gitignore 忽略，不入库。
 */
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  echoCommandLine,
  formatCommandLine,
} from "./launcher-core/command-echo.mjs";
import { pnpmInvocation } from "./launcher-core/shell.mjs";
// 启动页副本（`splash.html` + `index.html`）的清单与同步：与 dev-launcher 共用
// 同一份实现，避免「少写一个副本名」这类静默失误在两处各自发生。
import { syncSplashAssets } from "./launcher-core/splash-assets.mjs";

// 开发机私有输入（.env / db.sqlite*）的剔除清单与实现：与 `pnpm build` 的
// 收尾步骤共用同一份，避免两处清单各写一套后静默漂移。
import {
  BUILT_RUNTIME_SCRIPTS,
  RUNTIME_SCRIPTS,
  stripDevArtifacts,
  stripPrivateInputs,
  isStaticPathAllowed,
  pruneStaticToAllowList,
} from "./standalone-private-inputs.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const nextOut = join(root, ".next", "standalone");
const staticDir = join(root, "src-tauri", "static");
const binDir = join(root, "src-tauri", "binaries");

function targetTriple() {
  if (process.platform === "win32") {
    return process.arch === "arm64"
      ? "aarch64-pc-windows-msvc"
      : "x86_64-pc-windows-msvc";
  }
  if (process.platform === "darwin") {
    return process.arch === "arm64"
      ? "aarch64-apple-darwin"
      : "x86_64-apple-darwin";
  }
  return process.arch === "arm64"
    ? "aarch64-unknown-linux-gnu"
    : "x86_64-unknown-linux-gnu";
}

/**
 * sidecar 文件名（**平台判据的单点**，Rust 侧 `sidecar_binary_name()` 与之同源）。
 *
 * Tauri 的 `bundle.externalBin` 声明的是「无后缀 basename」：打包器按目标三元组
 * 去 `src-tauri/binaries/` 找 `node-<triple>[.exe]`，打进资源后按平台补
 * `node.exe` / `node`。这里若只产出 `.exe`（历史实现），Linux/macOS 上
 * `build.rs` 会在编译期直接 panic：
 *   表现为 resource path binaries/node-x86_64-unknown-linux-gnu 不存在
 * 而壳侧再写死 `node.exe`，即使编过也找不到 sidecar。两处必须同一个判据。
 * @param {string} triple @param {NodeJS.Platform} [platform]
 */
export function sidecarFileName(triple, platform = process.platform) {
  return platform === "win32" ? `node-${triple}.exe` : `node-${triple}`;
}

function fail(msg) {
  console.error(`[build-desktop] 错误：${msg}`);
  process.exit(1);
}

// 递归计算目录字节数（用于体积护栏 / Top 目录定位）
function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let ents;
    try {
      ents = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const p = join(cur, e.name);
      try {
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) total += statSync(p).size;
      } catch {
        /* 忽略无权限文件 */
      }
    }
  }
  return total;
}

// ── 1/4 next build（standalone）────────────────────────────
console.log("[build-desktop] 1/4 执行 pnpm build（Next standalone 输出）...");
// pnpm 的可执行形态由 shell.mjs 一处判定（规范 §2.1.1 / §9.5）：`execSync("pnpm …")`
// 走的是 shell，Windows 上选中批处理形态时同样起不来，而 shell 语义让「命令没起来」
// 与「跑完但失败」更难分辨。派生子进程一律经 pnpmInvocation，不自己拼可执行名。
{
  const invocation = pnpmInvocation(["build"]);
  if (!invocation) {
    fail("PATH 上找不到可用的 pnpm（先跑 pnpm check:toolchain 自查）。");
  }
  // 这一句是「1/4 执行 pnpm build」的**真实命令行**：构建日志里既有步骤名、也有
  // 到底跑了哪条命令，事后核对构建产物与命令的对应关系不必再猜。
  echoCommandLine(invocation.command, invocation.args);
  const build = spawnSync(invocation.command, invocation.args, {
    stdio: "inherit",
    cwd: root,
    windowsHide: true,
  });
  if (build.error) {
    fail(
      `起 pnpm 失败（${build.error.code ?? "UNKNOWN"}）：${build.error.message}；` +
        `实际命令：${formatCommandLine(invocation.command, invocation.args)}`,
    );
  }
  if (build.status !== 0)
    fail(`pnpm build 失败（exit ${build.status ?? "?"}）。`);
}
if (!existsSync(join(nextOut, "server.js"))) {
  fail(
    ".next/standalone/server.js 不存在，请确认 next.config.js 已配置 output: 'standalone'",
  );
}

// ── 2/4 组装 src-tauri/static ──────────────────────────────
console.log("[build-desktop] 2/4 组装 src-tauri/static ...");
rmSync(staticDir, { recursive: true, force: true });
mkdirSync(staticDir, { recursive: true });

// ── 2.1 §10.2 自动同步启动脚本 ─────────────────────────────
// 桌面包之外还要能被「开发/救援」链路重新编排一次（壳找不到 dev server 时，
// 用户会去双击项目里的启动入口）。因此启动编排器与它的运行期依赖（会话锚点、
// 端口解析、跨平台回收器）都要进 static/scripts —— 缺一份，桌面包里的启动
// 入口就会在运行时 ENOENT，而表现只是「双击没反应」。
// 清单与白名单同源：scripts/standalone-private-inputs.mjs 的 RUNTIME_SCRIPTS。
const launcherDestDir = join(staticDir, "scripts");
for (const launcherFile of RUNTIME_SCRIPTS.filter((name) =>
  name.endsWith(".mjs"),
)) {
  // BUILT_RUNTIME_SCRIPTS 是构建期由 scripts/build-executor-host.mjs 直接写进
  // .next/standalone 的产物（宿主的预编译运行时图，3-E1 / ISSUE #1169）——仓库里
  // 没有同名源文件，按「清单漂移」失败会把人引向错误方向。它们随下面的整树拷贝
  // 进 static，并由其后的「桌包里的宿主件在不在」断言兜住。
  if (BUILT_RUNTIME_SCRIPTS.includes(launcherFile)) continue;
  const launcherSrc = join(root, "scripts", launcherFile);
  if (!existsSync(launcherSrc)) {
    // 白名单里面写了但源文件不在 = 清单漂移。静默跳过会让桌面包里的编排器
    // 在运行时 ENOENT，而表现只是「双击没反应」，所以这里直接失败。
    fail(
      `白名单登记的运行期脚本不存在：scripts/${launcherFile}（与 RUNTIME_SCRIPTS 不同步）`,
    );
  }
  // 白名单条目允许是相对路径（`launcher-core/procs.mjs`）：目标子目录要先建出来。
  const dest = join(launcherDestDir, launcherFile);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(launcherSrc, dest);
  console.log(
    `[build-desktop]   §10.2 已自动同步 scripts/${launcherFile} → static/scripts/${launcherFile}`,
  );
}

// ── 2.1 §装配：static 的顶层是**默认拒绝**的白名单 ──
// 从 ISSUE #1216 起 `bundle.resources = ["static/"]` 会真的把这一层装进安装包，
// 所以「多带一个目录」必须在装配层就被看见，而不是等用户解包才发现。判据本体在
// `standalone-private-inputs.mjs` 的 `STATIC_ALLOWED_TOPLEVEL`（与产物层检查、
// 用例同源，不在这里再抄一份名单）。
//
// 为什么在**复制前**判而不是「整树拷来再删」：实测这一层今天躺着 `src/` 11.7 MB、
// `changelog.d/` 3.3 MB 与开发机的 `data/llm-secret.key`，白名单生效后这些一个字节
// 都不必复制。file tracing 仍会把它们带进 `.next/standalone`（根因与修法归
// ISSUE #1217），本条只管「装进桌包的那一份」。
// 注意：node_modules/.cache 单独排除，不能整体排除 node_modules（standalone
// 运行时必需裁剪版）。
const staticAllowed = (abs) => isStaticPathAllowed(relative(nextOut, abs));

cpSync(nextOut, staticDir, {
  recursive: true,
  dereference: true, // server.js + 裁剪 node_modules（解引用 symlink，避免 Windows 无开发者权限时 EPERM）
  filter: (src) => {
    const rel = relative(nextOut, src);
    if (rel === "") return true; // 根目录本身
    if (!staticAllowed(src)) return false;
    const cacheRel = join("node_modules", ".cache");
    return rel !== cacheRel && !rel.startsWith(cacheRel + sep);
  },
});

/* §装配：白名单的落盘兜底。filter 已在复制前挡掉名单外条目，这里保留作兜底
 * （有人绕过 filter 往 static 里写文件、或将来改复制方式时仍然兜得住），
 * 命中与否都只是空操作。 */
for (const name of pruneStaticToAllowList(staticDir)) {
  console.log(`[build-desktop]   §装配 已剔除桌包不带的顶层条目 static/${name}`);
}
rmSync(join(staticDir, "node_modules", ".cache"), {
  recursive: true,
  force: true,
});

// ── 2.2 分发卫生：剔除开发机私有输入（.env / db.sqlite*）──
// 清单与实现收在 scripts/standalone-private-inputs.mjs（`pnpm build` 的收尾
// 步骤已跑过一次；这里是组装后的兜底，也是唯一能覆盖 static 这一层的地方）。
// 目录级剔除挡不住文件：`next build` 会把仓库根的 `.env` 与 `db.sqlite` 一起
// 复制进 `.next/standalone`（前者是 Next standalone 的环境加载行为——实测
// `outputFileTracingExcludes` 写 `./.env` 也删不掉；后者是动态路径 tracing），
// 于是它们随 static 一起被**编译期内嵌进 exe**。两个后果都不是「多带了个文件」：
//   1) `.env` 里的 BETTER_AUTH_SECRET / OAuth client secret 以明文随包分发，
//      解包即得；
//   2) 壳以 `current_dir(res_dir)` 启动 sidecar，而 `resolveDbPath` 按
//      `process.cwd()` 解析 db.sqlite（见 src/server/db.ts）——被带进包的开发库
//      就是应用首次启动时读写的那一个，开发者本机数据会变成出厂数据。
// 因此这里**显式删除**这两类文件（含 SQLite 的 WAL/SHM 边车文件）：
// 分发产物必须是「干净安装」，配置文件由用户侧自行提供。
stripPrivateInputs(staticDir, (name) => {
  console.log(
    `[build-desktop]   §分发卫生 已剔除开发机私有输入 static/${name}`,
  );
});
// 开发期文件与内部门禁脚本同理：`next build` 的全项目 tracking 会把 AGENTS.md /
// CHANGELOG.md / 各 *.config.* 与 **整套 scripts/**（含 16 个 *.cjs 门禁脚本）
// 复制进产物，进而随 static 被内嵌进 exe。清单与实现在
// scripts/standalone-private-inputs.mjs（白名单保留运行时真的会读的那几个）。
stripDevArtifacts(staticDir, (name) => {
  console.log(`[build-desktop]   §分发卫生 已剔除开发期文件 static/${name}`);
});
// ── 2.3 §首启建表：把 schema 的 DDL 随包带出去 ──
// 为什么需要（ISSUE #1216 实测）：载荷里的 node_modules 只有生产依赖，**drizzle-kit 不在
// 其中**，桌包首启因此没有任何办法建表。把载荷跑起来后的现场是 `/workspace` 200、
// `/api/health` 503，而 hint 让人去「执行 pnpm db:push」——桌面用户既没有 pnpm 也没有
// 检出，这就是「页面开着、接口全 500」那一类形态。
//
// 形态选择：构建期用 `drizzle-kit export --sql` 出一份 DDL 随包（运行期由
// `scripts/standalone-runtime.mjs` 在**表为零**时执行）。**不**随包带一份「已经建好表的
// 空库」：那正是硬规则 17 挡过的事故——`next build` 会把开发机的 `db.sqlite` 复制进
// standalone，出厂库于是变成开发库（开发者本机数据变成用户的数据）。这里带出去的只有
// DDL，下面那条「不许有 INSERT」的断言就是这条选择的机器判据。
//
// 单一事实源不变：DDL 每轮构建都从 `src/server/db/schema.ts` 现生成，不另存一份手工 SQL
// （手工副本迟早与 schema 漂开，而漂开的表现是首启建出一张缺列的表）。
const schemaSqlPath = join(staticDir, "schema.sql");
{
  const invocation = pnpmInvocation([
    "exec",
    "drizzle-kit",
    "export",
    "--sql",
  ]);
  if (!invocation) {
    fail("PATH 上找不到可用的 pnpm，无法导出首启建表用的 DDL（先跑 pnpm check:toolchain）。");
  }
  echoCommandLine(invocation.command, invocation.args);
  const exported = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  const sql = (exported.stdout ?? "").trim();
  if (exported.status !== 0 || sql.length === 0) {
    fail(
      `drizzle-kit export 失败（exit ${exported.status ?? "?"}）：` +
        `${(exported.stderr ?? "").slice(0, 400) || "没有输出"}——桌包首启将没有建表能力`,
    );
  }
  // 判据两条：真有建表语句；且**没有任何数据语句**。
  if (!/CREATE TABLE/i.test(sql)) {
    fail("drizzle-kit export 的输出里没有 CREATE TABLE——DDL 导出口径变了，请检查本步。");
  }
  if (/INSERT INTO/i.test(sql)) {
    fail(
      "drizzle-kit export 的输出里出现 INSERT INTO：首启 DDL 只许建结构、不许带数据，" +
        "否则等于把开发机数据做成出厂数据（硬规则 17）。",
    );
  }
  writeFileSync(schemaSqlPath, `${sql}\n`, "utf8");
  console.log(
    `[build-desktop]   §首启建表 已导出 static/schema.sql（${((sql.length / 1024) | 0) + 1} KB，只含 DDL）`,
  );
}

// 剪枝之后**逐件断言载荷必备件还在**：`scripts/**` 走白名单剪枝，白名单登记与这里的
// 断言是同一件事的两半——登记漏了会被剪掉，断言漏了则「桌包里设 host 起不来 /
// standalone 起不来」要等到用户现场才发现（`.next/standalone` 那层的冒烟只跑得到自己那层）。
for (const payloadFile of [
  "scripts/executor-host.mjs",
  "scripts/executor-host.runtime.mjs",
  "scripts/executor-host.build.json",
  // standalone 运行入口与其环境装配：分发产物不含 .env，运行期配置只由这份入口装配，
  // 被 §装配 白名单误剪掉的表现是「壳起不了 server」（ISSUE #1216）。
  "scripts/standalone-runtime.mjs",
  "scripts/launcher-core/standalone-runtime-env.mjs",
  // 首启建表的 DDL（上面 §首启建表 产出）：缺它 = 桌包首启建不出表，页面 200 接口全 500。
  "schema.sql",
]) {
  if (!existsSync(join(staticDir, payloadFile))) {
    fail(
      `桌包缺件 static/${payloadFile}：先跑 pnpm build（收尾生成宿主的预编译运行时图），` +
        "再确认 standalone-private-inputs.mjs 的 RUNTIME_SCRIPTS / STATIC_ALLOWED_TOPLEVEL " +
        "登记了这一条",
    );
  }
}
// ── 2.4 §载荷实体化：把 pnpm 的软链结构摊平成可分发的真实目录 ──
// 为什么必须做（ISSUE #1216 实测）：`.next/standalone/node_modules` 的**顶层条目是指向
// 仓库 store 的绝对软链**（`next -> <repo>/node_modules/.pnpm/next@…/node_modules/next`），
// Next 的追踪只把被引用的那份文件拷进 `.pnpm/` 里。于是 `cpSync({dereference:true})`
// 之后顶层 `next` 成了真实目录，而它赖以解析的**兄弟包**（`@swc/helpers` 等）仍在
// `.pnpm/<key>/node_modules/` 那一层——真起 server 的表现是
// `Cannot find module '@swc/helpers/_/_interop_require_default'`，require stack 指向
// `next/dist/server/config.js`，看起来像产物缺件，实际是**布局语义**没搬过来。
// 判据来自实跑：修好后 `/workspace` 200、`/api/health` 503（那句「表还没建」是首启
// 正常态），没修之前 server 直接 exit 1。
//
// 形态选择：把 store 里的包**上提**到顶层（先看 pnpm 的 hoist 兜底层
// `.pnpm/node_modules/`，再看各包的私有层），然后把 `.pnpm` 整棵删掉——不是「上提后
// 再留一份 store」，实测那样载荷是 404 MB，扁平化后是 245 MB。
// 同名多版本时取第一个发现者：这与 pnpm 自己在 hoist 兜底层的取舍同形，且下面的
// 「载荷可解析性断言」会在构建期就把选错的那一类抓出来（不是等用户双击）。
const storeDir = join(staticDir, "node_modules", ".pnpm");
if (existsSync(storeDir)) {
  const nmDir = join(staticDir, "node_modules");
  /** 包名（含 `@scope/name`）→ 源目录。Map 的首个命中者胜出 = 上面那条优先级。 */
  const packages = new Map();
  const collectLevel = (base) => {
    if (!existsSync(base)) return;
    for (const entry of readdirSync(base)) {
      if (entry.startsWith(".")) continue;
      const abs = join(base, entry);
      if (!existsSync(abs) || !statSync(abs).isDirectory()) continue;
      if (entry.startsWith("@")) {
        for (const sub of readdirSync(abs)) {
          const subAbs = join(abs, sub);
          if (!packages.has(`${entry}/${sub}`) && existsSync(subAbs)) {
            packages.set(`${entry}/${sub}`, subAbs);
          }
        }
        continue;
      }
      if (!packages.has(entry)) packages.set(entry, abs);
    }
  };
  collectLevel(join(storeDir, "node_modules"));
  for (const key of readdirSync(storeDir)) {
    if (key === "node_modules") continue;
    collectLevel(join(storeDir, key, "node_modules"));
  }
  let hoisted = 0;
  for (const [rel, src] of packages) {
    const dest = join(nmDir, rel);
    if (existsSync(dest)) continue;
    cpSync(src, dest, { recursive: true, dereference: true });
    hoisted += 1;
  }
  rmSync(storeDir, { recursive: true, force: true });
  console.log(
    `[build-desktop]   §载荷实体化 上提 ${hoisted} 个包并删除 .pnpm（顶层 ${packages.size} 个候选名）`,
  );

  // 载荷可解析性断言：这些是 server 启动路径上**必定**要解析的模块，其中
  // `@swc/helpers/_/_interop_require_default` 就是本次实测最先炸掉的那一个。
  // 缺件在这里失败 = 构建期就拦住；放过去就是用户双击时「窗口停在启动页」。
  const requireFromPayload = createRequire(join(staticDir, "package.json"));
  const mustResolve = [
    "next/dist/server/next.js",
    "@swc/helpers/_/_interop_require_default",
    "@libsql/client",
  ];
  const unresolved = mustResolve.filter((spec) => {
    try {
      requireFromPayload.resolve(spec);
      return false;
    } catch {
      return true;
    }
  });
  if (unresolved.length > 0) {
    fail(
      `桌包载荷解析不到这些运行期模块：${unresolved.join(", ")}——` +
        "standalone server 起不来（表现是窗口停在启动页）。先查上面的 §载荷实体化 是否被跳过。",
    );
  }
  console.log(
    `[build-desktop]   §载荷实体化 可解析性断言通过（${mustResolve.join(", ")}）`,
  );
}

cpSync(join(root, ".next", "static"), join(staticDir, ".next", "static"), {
  recursive: true,
});
if (existsSync(join(root, "public"))) {
  cpSync(join(root, "public"), join(staticDir, "public"), { recursive: true });
}

// 启动页：Tauri 窗口初始 URL 为 splash.html（tauri.conf.json windows[0].url）。
// public/splash.html 在 Next.js dev 模式下由 localhost:3100/splash.html 服务；
// 生产构建时把它复制到 static 根，让 Tauri 内置服务器直接提供。
const splashSrc = join(root, "public", "splash.html");
if (existsSync(splashSrc)) {
  copyFileSync(splashSrc, join(staticDir, "splash.html"));
}

// 同步启动页到 frontendDist（splash-assets/）：Tauri 窗口内嵌资源在编译期
// 来自该目录（tauri.conf.json build.frontendDist）。不同步的话重编壳时嵌入的
// 还是旧版启动页（历史故障：壳内 embedded=true 但内容陈旧/缺失 → 黑屏）。
// 副本清单与同步动作走共享实现（`launcher-core/splash-assets.mjs`）——
// 与 dev-launcher 同一份，这里不再自己列一遍副本名。
if (existsSync(splashSrc)) {
  const synced = syncSplashAssets(root);
  console.log(
    synced.status === "error"
      ? `[build-desktop]   启动页同步失败：${synced.message}`
      : `[build-desktop]   已同步启动页 → src-tauri/splash-assets/（${synced.names.join(" + ")}，frontendDist，编译期嵌入）`,
  );
}

// fallback index.html：与 splash.html 内容一致，避免直接访问根路径时出现旧 spinner
const splashHtml = existsSync(splashSrc)
  ? readFileSync(splashSrc, "utf8")
  : `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Comfy APP</title></head>
<body style="background:#0A0A0F;color:#E5E5E7;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui,sans-serif;">Comfy APP 正在启动…</body></html>`;
writeFileSync(join(staticDir, "index.html"), splashHtml, "utf8");

console.log(
  "[build-desktop]   static 组装完成（standalone + .next/static + public + splash.html + index.html fallback）",
);

// ── 2.5 §整治：体积护栏 ──
// 若 static 仍超过阈值，说明 Next standalone file tracing 再次失控（把整仓库
// 根塞了进来）。立即失败并列出 Top 目录，绝不把 >GB 级副本打包进 exe。
const MAX_STATIC_GB = 1.5;
const totalMB = dirSize(staticDir) / 1024 / 1024;
if (totalMB / 1024 > MAX_STATIC_GB) {
  const top = readdirSync(staticDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({
      name: e.name,
      mb: dirSize(join(staticDir, e.name)) / 1024 / 1024,
    }))
    .sort((a, b) => b.mb - a.mb)
    .slice(0, 8);
  fail(
    `static 体积 ${(totalMB / 1024).toFixed(2)}GB 超过护栏阈值 ${MAX_STATIC_GB}GB，` +
      "说明 Next standalone file tracing 再次失控。Top 目录: " +
      top.map((t) => `${t.name}=${t.mb.toFixed(0)}MB`).join(", ") +
      "。请检查 next.config.js 的 outputFileTracingExcludes 是否覆盖了新的大目录。",
  );
}
console.log(
  `[build-desktop]   static 体积 ${totalMB.toFixed(1)}MB（护栏阈值 ${MAX_STATIC_GB}GB）`,
);

// ── 3/4 Node 运行时 sidecar ────────────────────────────────
console.log("[build-desktop] 3/4 复制 Node 运行时为 sidecar ...");
mkdirSync(binDir, { recursive: true });
const sidecar = join(binDir, sidecarFileName(targetTriple()));
copyFileSync(process.execPath, sidecar);
// 非 Windows 上 sidecar 必须可执行：Tauri 把它作为独立可执行文件按路径调用，
// 少了执行位就是「服务起来后立刻退出、却没有任何报错」。
if (process.platform !== "win32") {
  chmodSync(sidecar, 0o755);
}
console.log(
  `[build-desktop]   sidecar: ${sidecar} (${(statSync(sidecar).size / 1024 / 1024).toFixed(1)} MB)`,
);

// ── 4/4 完成 ───────────────────────────────────────────────
console.log("[build-desktop] 4/4 完成。请执行 pnpm tauri build 打出安装包。");
