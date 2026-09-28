#!/usr/bin/env node
// @ts-nocheck -- build-time script: runs outside the Next module graph
/**
 * 对「已构建出来的 standalone 产物」里的执行器宿主做一次冒烟。
 *
 * 为什么要单独一步（P3 §5，ISSUE #1169 / 3-E1）：要防的是同一个形状的故障——
 * **产物看起来齐全、配置也都对，但宿主就是 boot 不起来**。规范 §7.4 那次
 * `app-route-turbo` 缺件就是这个形状（页面全 200、接口全 500）。整条工具链里
 * 没有任何其他地方会去起「产物里的那份宿主」：`pnpm dev` 不碰产物，而
 * `next start` 与这里的 `output: standalone` 不兼容——所以只查配置的门禁等于在
 * 断言一句没人验证过的承诺。
 *
 * 查的三件事，按「失败时哪一条最可行动」排序：
 *   1. 预编译运行时图与它的构建清单在不在
 *      （`scripts/executor-host.runtime.mjs` / `executor-host.build.json`）
 *   2. bundle 记账下来的每个 external（扣掉 Node 内置模块）**能不能从产物里解析到**
 *      ——这一条抓的是「`drizzle-orm` 根本不在产物的 node_modules 里」那类问题，
 *      趁还没把坏包发给使用者之前抓住
 *   3. 产物里的那份宿主**真的能 boot**：在产物目录内跑
 *      `node scripts/executor-host.mjs --once`，必须退出 0 且日志出现 `runtime inject-ok`
 *
 * `--once` 在 boot + 注入 + 一次队列扫描之后就退出，所以这里既不派发任务，也不需要
 * 一个在跑的 ComfyUI。
 *
 * 挂在 `pnpm build` 的收尾（见 package.json）：桌包组装的 1/4 步就是 `pnpm build`
 * （`scripts/build-desktop.mjs`），所以那条路必然经过这里。
 *
 * 用法：node scripts/smoke-executor-host-standalone.mjs [targetDir]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { builtinModules } from "node:module";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TARGET = path.join(ROOT, ".next", "standalone");
const BUNDLE_REL = path.join("scripts", "executor-host.runtime.mjs");
const MANIFEST_REL = path.join("scripts", "executor-host.build.json");
const HOST_ENTRY_REL = path.join("scripts", "executor-host.mjs");
const BUILTIN = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

function fail(into, message) {
  into.push(message);
}

/**
 * @param {string} targetDir
 * @returns {{ ok: boolean, problems: string[], detail: string[] }}
 */
export function smokeExecutorHostArtifact(targetDir = DEFAULT_TARGET) {
  const detail = [];
  const problems = [];
  const hostEntry = path.join(targetDir, HOST_ENTRY_REL);
  const bundle = path.join(targetDir, BUNDLE_REL);
  const manifestPath = path.join(targetDir, MANIFEST_REL);

  if (!fs.existsSync(path.join(targetDir, "server.js"))) {
    fail(
      problems,
      `no artifact at ${targetDir} (server.js missing) - run next build first`,
    );
    return { ok: false, problems, detail };
  }
  for (const [label, file] of [
    ["runtime bundle", bundle],
    ["build manifest", manifestPath],
    ["host entry", hostEntry],
  ]) {
    if (!fs.existsSync(file)) {
      fail(
        problems,
        `${label} missing from the artifact: ${path.relative(ROOT, file)} ` +
          "(expected scripts/build-executor-host.mjs to have emitted it during `pnpm build`)",
      );
    }
  }
  if (problems.length > 0) return { ok: false, problems, detail };

  /** @type {{ externals?: string[], inputs?: string[], bytes?: number }} */
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  // 1) 每个非内置 external 都必须能从产物里解析到
  const requireFromArtifact = createRequire(
    path.join(targetDir, "package.json"),
  );
  const missing = (manifest.externals ?? [])
    .filter((spec) => !BUILTIN.has(spec) && !spec.startsWith("node:"))
    .filter((spec) => {
      try {
        requireFromArtifact.resolve(spec);
        return false;
      } catch {
        return true;
      }
    });
  if (missing.length > 0) {
    fail(
      problems,
      `bundle externals not resolvable from the artifact: ${missing.join(", ")} ` +
        "- either keep them bundled or add them to the standalone node_modules " +
        "(spec 7.4: only outputFileTracingIncludes can add files back)",
    );
  }
  detail.push(
    `externals ok (${(manifest.externals ?? []).length} recorded, ` +
      `${(manifest.inputs ?? []).length} bundled inputs, ${((manifest.bytes ?? 0) / 1024) | 0} KB)`,
  );

  // 2) 真起产物里那份宿主。故意给它一个全新的空库：装好之后第一次运行时库里还没有
  //    表（schema 同步发生在宿主被拉起之后），所以「boot 就要求表存在」的宿主会先把
  //    真实用户挡下来——这一条同时是 §18.4 纯 Node 宿主「先判就绪」的现场验证。
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "comfyapp-host-smoke-"));
  const dbFile = path.join(tmp, "empty.sqlite");
  const logFile = path.join(tmp, "host.log");
  try {
    const run = spawnSync(process.execPath, [hostEntry, "--once"], {
      cwd: targetDir,
      encoding: "utf8",
      env: {
        ...process.env,
        COMFY_EXECUTOR: "host",
        DATABASE_URL: `file:${dbFile}`,
        COMFYAPP_HOST_LOG: logFile,
        COMFYAPP_HOST_TRACE: path.join(tmp, "trace.log"),
      },
      timeout: 120_000,
    });
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
    const stdout = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    if (run.status !== 0) {
      fail(
        problems,
        `packaged host exited ${run.status ?? `signal ${run.signal}`}: ` +
          `${(log || stdout).split("\n").slice(-6).join(" | ")}`,
      );
    } else if (!/runtime inject-ok/.test(log)) {
      fail(
        problems,
        `packaged host exited 0 without injecting the runtime graph (no ` +
          `"runtime inject-ok" line): ${(log || stdout).split("\n").slice(-6).join(" | ")}`,
      );
    } else if (/boot FAILED/.test(log)) {
      fail(
        problems,
        `packaged host logged a boot FAILED line: ${log.split("\n").slice(-4).join(" | ")}`,
      );
    }
    const q2 = /runtime q2-scan hostShardQueued=(\S+)/.exec(log);
    if (q2) detail.push(`queue scan reported ${q2[1]}`);
    else if (run.status === 0)
      fail(problems, "packaged host never reached the queue scan");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  return { ok: problems.length === 0, problems, detail };
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const target = process.argv[2]
    ? path.resolve(ROOT, process.argv[2])
    : DEFAULT_TARGET;
  const result = smokeExecutorHostArtifact(target);
  for (const line of result.detail) {
    console.log(`[executor-host-smoke] ${line}`);
  }
  if (!result.ok) {
    for (const p of result.problems) {
      console.error(`[ERROR] ${p}`);
    }
    console.error(
      "[ERROR] see docs/standards/launch-and-build.md section 7.5 " +
        "(why the smoke is the last step of `pnpm build`)",
    );
    process.exit(1);
  }
  console.log(
    "[executor-host-smoke] OK packaged host booted with the precompiled runtime graph",
  );
}
