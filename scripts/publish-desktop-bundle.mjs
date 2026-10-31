#!/usr/bin/env node
/**
 * publish-desktop-bundle.mjs — 把 `pnpm tauri build` 打出的**安装包**发布到一个**常驻目录**
 * （ISSUE #2503）。
 *
 * ## 它补的是哪一格
 *
 * 现成的执行者已经负责「打出来」：`scripts/build-desktop.mjs`（Next standalone → 装配
 * `src-tauri/static` → sidecar）+ `pnpm tauri build`（cargo 编译 + NSIS/MSI 打包）。
 * 本文件**只补发布那一格**（§12.18 复用优先）——它不构建、不判据、不重抄任何一个阈值。
 *
 * 为什么必须有一个名字：CI 的工作区是**每跑新建**的（runner 收尾整目录删掉），所以
 * 「安装包」这个东西过去活不过那一跑；本地那条链（`tools/build/build-all.ps1`）产出的
 * 也一样只在 `src-tauri/target/release/bundle` 待着，下一次构建就把它覆盖了。两边都
 * 需要同一个去处，而那一格不能各写一遍（§12.12 孪生对）。
 *
 * ## 落成的形状（三条是不可换的）
 *
 * · **常驻根由推导给**：`resolveArtifactRoot`（同一个 `pnpm store path` 问法，拼
 *   `ci-artifacts/<包名>`）。**不硬编码盘符** —— 换卷就不成立。
 * · **一份一个目录，`latest` 只是指针文件**：目录名 = 标签（sha + 构建号/时刻），
 *   写 `<root>/latest.txt` 一行指过去。**不原地覆盖同名目录**：覆盖会让「latest 那一格
 *   到底是什么时候的东西」只能靠 mtime 猜，而这是规范 §4.3「运行图落后于源码」那一族的
 *   第二个源。
 * · **每份自带 `manifest.json`**：sha / 构建号 / 事件键 / 时刻 / 体积 / 文件清单。
 *   无 manifest 的目录在本单里是**不许存在**的形态 —— 轮转那一刀按 manifest 的
 *   `builtAt` 排序，读不到就按目录 mtime 退一档处理并念出来。
 *
 * ## 退出码（三态，不许把「没结论」读成「没事」）
 *
 * · `0` 发布完成（含轮转）。
 * · `1` 失败：没有可发布的成品 / 写盘被拒 / 同标签已存在（那是第二次构建，不是重发）。
 * · `2` **没有结论**：问不出常驻根、或目标卷空间不够。这两条都不许静默退 0 ——
 *   「今天没有新包」与「今天没能把包放出去」在日志里必须逐字不同。
 *
 * ## 用法
 *
 *   node scripts/publish-desktop-bundle.mjs              # 发布 src-tauri/target/release/bundle
 *   node scripts/publish-desktop-bundle.mjs --dry-run    # 只打印会做什么（本机自查 / 用例）
 *   node scripts/publish-desktop-bundle.mjs --keep 2 --label <标签>
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { runContext } from "./ci-daily-build.mjs";
import { ARTIFACT_ROOT_ENV, resolveArtifactRoot } from "./ci-cache-slot.mjs";
import { hasRoomForSlot } from "./ci-slot-apply.mjs";
import { runPnpmSync } from "./launcher-core/shell.mjs";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");

/** 安装包扩展名（跨平台都收：Windows 的 nsis/msi 是本档主形，其余是同一条链在别的卷上的产物）。 */
const INSTALLER_EXTENSIONS = new Set([".exe", ".msi", ".dmg", ".app", ".AppImage", ".deb", ".rpm"]);

/** 指针文件的名字（不是目录 —— 见上面「三条不可换」的第二条）。 */
export const LATEST_POINTER_FILE = "latest.txt";

/** manifest 的文件名。 */
export const MANIFEST_FILE = "manifest.json";

/** 暂存目录的前缀：先落 `<root>/.staging-<标签>`，全部写完再整目录改名过去。 */
const STAGING_PREFIX = ".staging-";

/** 默认留几份（业主口径：最近 2 份）。 */
export const DEFAULT_KEEP = 2;

/** 默认从哪儿取成品（`pnpm tauri build` 的 bundle 输出根）。 */
const DEFAULT_BUNDLE_DIR = path.join("src-tauri", "target", "release", "bundle");

/**
 * 一份成品的形状（`collectBundles` 的产出、`manifest.files` 的来源）。
 *
 * @typedef {{relPath: string, absPath: string, bytes: number}} BundleEntry
 */

/**
 * manifest 里除标签与文件清单之外那几项（身份与时刻）。
 *
 * @typedef {{sha: string, event: string, buildId: string, user: string,
 *   builtAt: string, appVersion: string}} ManifestIdentity
 */

/**
 * 这一跑的输入。起进程的两步（问 store 根、读 git sha）都是注入面 —— 用例不该因为
 * 某台机器当时问不出 `pnpm store path` 而红（那是环境事实，不是判据的结论）。
 *
 * @typedef {{argv?: string[], cwd?: string, env?: Record<string, string | undefined>,
 *   log?: (line: string) => void, now?: Date,
 *   runGit?: (args: string[]) => string,
 *   runStore?: (args: string[], opts: object) => {status: number | null, stdout?: string}}} PublishIo
 */

/**
 * 解析出来的计划（`--dry-run` 打印的就是它，落盘用的也是它 —— 同一份，不分两条路）。
 *
 * @typedef {{bundleDir: string, keep: number, dryRun: boolean, label: string,
 *   root: string | null, rootFrom: string, manifestFields: ManifestIdentity}} PublishPlan
 */

/**
 * 递归收集安装包。
 *
 * 只收扩展名命中的文件，目录结构按 bundle 根的相对路径保留（`nsis/…-setup.exe` 与
 * `msi/…-setup.msi` 不会互相覆盖）。
 *
 * @param {string} bundleDir @returns {{relPath: string, absPath: string, bytes: number}[]}
 */
export function collectBundles(bundleDir) {
  /** @type {{relPath: string, absPath: string, bytes: number}[]} */
  const found = [];
  if (!fs.existsSync(bundleDir)) {
    return found;
  }
  /** @param {string} dir @param {string} rel */
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, relPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!INSTALLER_EXTENSIONS.has(path.extname(abs))) {
        continue;
      }
      found.push({ relPath, absPath: abs, bytes: fs.statSync(abs).size });
    }
  };
  walk(bundleDir, "");
  return found.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/**
 * 标签 = 「这份是哪个 sha、哪一次构建打的」，可直接当目录名。
 *
 * CI 上 `CNB_BUILD_ID` 就是那一跑的身份；本机没有它，退到 UTC 时刻（可排序、不会撞）。
 *
 * @param {{sha?: string, buildId?: string, now?: Date}} [input]
 * @returns {string}
 */
export function buildLabel({ sha, buildId, now = new Date() } = {}) {
  const head = String(sha ?? "").trim() || "nosha";
  const id = String(buildId ?? "").trim();
  const tail =
    id && !id.includes("(")
      ? `b${id.replaceAll(/[^0-9A-Za-z._-]/g, "-")}`
      : now.toISOString().replaceAll(/[-:]/g, "").replace(/\..+$/, "").replace("T", "t");
  return `${head}-${tail}`.replaceAll(/[^0-9A-Za-z._-]/g, "-");
}

/**
 * manifest 的内容（纯数据，不碰盘 —— 这样它能被单独断言，而不必真拷一份安装包）。
 *
 * @param {{label: string, entries: BundleEntry[], keep: number} & ManifestIdentity} input
 */
function buildManifest({ label, sha, event, buildId, user, builtAt, appVersion, entries, keep }) {
  return {
    label,
    sha,
    event,
    buildId,
    user,
    builtAt,
    appVersion,
    keep,
    totalBytes: entries.reduce((sum, e) => sum + e.bytes, 0),
    files: entries.map((e) => ({ path: e.relPath, bytes: e.bytes })),
  };
}

/**
 * 列出常驻根下的**成品目录**（跳过暂存目录与指针文件）。
 *
 * @param {string} root @returns {{name: string, dir: string, builtAt: string|null}[]}
 */
export function listReleases(root) {
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith(STAGING_PREFIX))
    .map((d) => {
      const dir = path.join(root, d.name);
      let builtAt = null;
      try {
        builtAt =
          String(
            JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILE), "utf8")).builtAt ?? "",
          ) || null;
      } catch {
        /* 没有可读的 manifest —— 交给调用方按 mtime 退档处理，这里不替它编一个时刻。 */
      }
      return { name: d.name, dir, builtAt };
    });
}

/**
 * 「留 N 份」要删哪些（纯函数，可单独断言）。
 *
 * 排序键优先 manifest 的 `builtAt`，读不到就退回目录 mtime 并**念出来**：一个目录没有
 * manifest 是缺陷，但把轮转停在那里等于让缺陷变成「盘上无限长」——两害里选可观测的那个。
 *
 * @param {{name: string, dir: string, builtAt: string|null}[]} releases @param {number} keep
 * @param {(line: string)=>void} [log]
 * @returns {{keepDirs: {name: string}[], dropDirs: {name: string}[], unstamped: string[]}}
 */
export function planRotation(releases, keep, log = () => {}) {
  /** @type {string[]} */ const unstamped = [];
  const stamped = releases.map((r) => {
    let at = r.builtAt ? Date.parse(r.builtAt) : Number.NaN;
    if (!Number.isFinite(at)) {
      unstamped.push(r.name);
      at = fs.existsSync(r.dir) ? fs.statSync(r.dir).mtimeMs : 0;
    }
    return { ...r, at };
  });
  if (unstamped.length > 0) {
    log(
      `[发布] ⚠ ${unstamped.length} 个目录读不到 manifest 的 builtAt（按目录 mtime 排）：` +
        unstamped.join(", "),
    );
  }
  const sorted = stamped.sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
  return {
    keepDirs: sorted.slice(0, Math.max(0, keep)).map((r) => ({ name: r.name })),
    dropDirs: sorted.slice(Math.max(0, keep)).map((r) => ({ name: r.name })),
    unstamped,
  };
}

/**
 * 参数 → 计划输入。
 *
 * @param {PublishIo} [io] @returns {PublishPlan}
 */
function resolvePlan(io = {}) {
  const {
    argv = process.argv.slice(2),
    cwd = ROOT,
    env = process.env,
    runGit = (args) => {
      const r = spawnSyncGit(args, cwd);
      return r.ok ? r.stdout : "";
    },
    runStore = (args, opts) => runPnpmSync(args, { ...opts, stdio: "pipe" }),
    now = new Date(),
  } = io;
  const args = new Set(argv);
  const flag = /** @param {string} name */ (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? String(argv[i + 1] ?? "") : "";
  };
  const bundleDir = path.resolve(cwd, flag("--bundle-dir") || DEFAULT_BUNDLE_DIR);
  const keepRaw = flag("--keep");
  const keep = keepRaw ? Number.parseInt(keepRaw, 10) : DEFAULT_KEEP;
  const context = runContext(/** @type {NodeJS.ProcessEnv} */ (env));
  const sha = String(runGit(["rev-parse", "HEAD"]) ?? "").trim();
  const resolved = resolveArtifactRoot({ cwd, env, run: runStore });
  const label = flag("--label") || buildLabel({ sha, buildId: context.buildId, now });
  return {
    bundleDir,
    keep: Number.isFinite(keep) && keep > 0 ? keep : DEFAULT_KEEP,
    dryRun: args.has("--dry-run"),
    label,
    root: resolved.root,
    rootFrom: resolved.from,
    manifestFields: {
      sha: sha || "(无)",
      event: context.event,
      buildId: context.buildId,
      user: context.user,
      builtAt: now.toISOString(),
      appVersion: readAppVersion(cwd),
    },
  };
}

/** @param {string} cwd @returns {string} */
function readAppVersion(cwd) {
  try {
    return String(
      JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")).version ?? "",
    );
  } catch {
    return "(读不到)";
  }
}

/** @param {string[]} args @param {string} cwd @returns {{ok: boolean, stdout: string}} */
function spawnSyncGit(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, stdout: String(r.stdout ?? "").trim() };
}

/**
 * 主流程。
 *
 * 起进程的两步（问 store 根、读 git sha）都可注入 —— 用例不该因为某台机器当时问不出
 * `pnpm store path` 而红（那是环境事实，不是判据的结论；同 `ci-build-cache-slot.mjs`
 * 给空间探针开的那个口子）。
 *
 * @param {PublishIo} [io]
 * @returns {number} 0 成功 / 1 失败 / 2 没有结论
 */
export function main(io = {}) {
  const log = io.log ?? ((line) => process.stdout.write(`${line}\n`));
  const plan = resolvePlan(io);
  log(`[发布] 常驻根：${plan.root ?? "取不到"}（来源：${plan.rootFrom}）`);
  if (!plan.root) {
    log(
      "[发布] **没有结论**：问不出常驻根 ⇒ 一份成品都不落。" +
        `出口是配 ${ARTIFACT_ROOT_ENV}，或让 \`pnpm store path\` 答得出来。`,
    );
    return 2;
  }
  const entries = collectBundles(plan.bundleDir);
  if (entries.length === 0) {
    log(`[发布] 失败：${plan.bundleDir} 下没有安装包 —— 构建那一格没打出成品。`);
    return 1;
  }
  const needed = entries.reduce((sum, e) => sum + e.bytes, 0);
  log(
    `[发布] 取到 ${entries.length} 份成品·合计 ${(needed / 1024 ** 2).toFixed(1)} MiB` +
      `·标签 ${plan.label}`,
  );
  for (const e of entries) {
    log(`[发布]   ${e.relPath}  ${(e.bytes / 1024 ** 2).toFixed(1)} MiB`);
  }
  const room = hasRoomForSlot({ path: plan.root, floorBytes: needed });
  if (!room.ok) {
    log(`[发布] **没有结论**：目标卷放不下这一份（${room.why}）。不降级、不删旧的腾地方。`);
    return 2;
  }
  const target = path.join(plan.root, plan.label);
  const manifest = buildManifest({
    label: plan.label,
    keep: plan.keep,
    entries,
    ...plan.manifestFields,
  });
  const existing = listReleases(plan.root);
  const rotation = planRotation(
    existing.filter((r) => r.name !== plan.label),
    plan.keep - 1,
    log,
  );
  log(
    `[发布] 计划：落 ${target}·留 ${plan.keep} 份·本轮后删 ` +
      `${rotation.dropDirs.map((d) => d.name).join(", ") || "（无）"}`,
  );
  if (plan.dryRun) {
    log("[发布] --dry-run：不落盘。");
    return 0;
  }
  if (fs.existsSync(target)) {
    log(
      `[发布] 失败：${plan.label} 已经发布过（同标签 = 同一次构建）。` +
        "重发请换标签，不许原地覆盖 —— 覆盖之后「这一份是什么时候的」就没有可读的来源了。",
    );
    return 1;
  }
  const staging = path.join(plan.root, `${STAGING_PREFIX}${plan.label}`);
  try {
    fs.mkdirSync(staging, { recursive: true });
    for (const e of entries) {
      const dest = path.join(staging, e.relPath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(e.absPath, dest);
    }
    fs.writeFileSync(path.join(staging, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    fs.renameSync(staging, target);
    fs.writeFileSync(path.join(plan.root, LATEST_POINTER_FILE), `${plan.label}\n`);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    log(`[发布] 失败：写盘被拒 —— ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  log(`[发布] 已落 ${target}`);
  log(
    `[发布] 指针 ${path.join(plan.root, LATEST_POINTER_FILE)} → ${plan.label}` +
      "（它是文件，不是目录）",
  );
  for (const drop of rotation.dropDirs) {
    const dir = path.join(plan.root, drop.name);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      log(`[发布] 轮转删 ${drop.name}`);
    } catch (error) {
      log(
        `[发布] 轮转删不掉 ${drop.name}（不阻断本次发布）：` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(main());
}
