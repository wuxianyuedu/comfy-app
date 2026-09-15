#!/usr/bin/env node
// corepack 运维通道：把「pnpm 本身坏了」从**只诊断**补成**可修复 + 可复核**。
//
// 为什么需要它（Issue #576）：工具链门禁此前只能报一句
//   pnpm 工具链不可用（exit=?）：未知错误
// 然后把「疑似 corepack 缓存损坏」当结论写出来，动作是让人手工执行
// `corepack prepare pnpm@<项目版本> --activate`。三个问题叠在一起：
//   1. **结论下错了**：探测失败的真实成因里，「PATH 上选中的 shim 根本起不来」
//      比「缓存损坏」常见得多（见 shell.mjs::whichCommand）。把猜测写成结论，
//      用户会照着错的方向删缓存、重装 Node，而真正该做的是别选中那个 shim。
//   2. **动作里没有版本号**：`<项目版本>` 是占位符 —— 项目版本唯一的事实源是
//      package.json 的 `packageManager`，要修的人得自己去翻；没人翻就直接跳过。
//   3. **修完没有复核**：corepack prepare 的退出码不代表 pnpm 又能用了
//      （prepare 成功而 shim 仍不可执行是常态），「修好了」只能靠再启动一次撞运气。
//
// 本模块把三件事补齐，**不引入新的入口形态**：它是启动编排器内部的一步
// （`orchestratePnpm()`，只走 `.mjs`，Windows / POSIX 同一份），双击链路与
// `pnpm dev` 都能享受到，不需要任何 `.ps1` / Python 侧抄一份。
//
// 判据收口（规范 §9.5「一份逻辑两端复用」）：
//   · 版本号只从 package.json 的 `packageManager` 解析（`packageManagerVersion()`），
//     不写死、也不接受调用方再传一份；
//   · 「跑得通」的判据只有一处（`probePnpm()`），修复前后的复核都用它；
//   · 命令清单一律从 `shell.mjs` 的 `whichCommand` / `usableCommand` 取，
//     本模块不自己拼可执行名与平台后缀。

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { commandInvocation, whichCommand } from "./shell.mjs";

/** 探测选项（`env` / `platform` 可注入，单测与「模拟另一平台」都靠它）。 */
/**
 * @typedef {{ root?: string, env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *             platform?: NodeJS.Platform }} ProbeOptions
 */

/** 一次命令探测的结构化结论。`reason` 是机器可判的成因键，`reasonText` 是给用户看的短句。 */
/**
 * @typedef {{ ok: boolean, command: string | null, version: string | null,
 *             reason: ProbeReason, reasonText: string, detail: string,
 *             exitCode: number | null }} ProbeResult
 */

/** 探测失败的成因键（`ok: true` 时恒为 `"ok"`）。 */
/**
 * @typedef {"ok" | "spawn-error" | "no-version" | "exit-nonzero" | "not-found"} ProbeReason
 */

/** 探测 pnpm 的超时：正常 `pnpm -v` 在 1s 内返回，30s 只为兜住首次 corepack 解压。 */
const PROBE_TIMEOUT_MS = 30_000;
/** corepack prepare 需要联网下载对应版本，给足时间（与编排器的 .ps1 时代同量级）。 */
const PREPARE_TIMEOUT_MS = 600_000;

/** package.json 里声明的 pnpm 版本（`packageManager: "pnpm@12.4.1"` → `"12.4.1"`）。
 *  解析不到返回 null —— 调用方据此跳过修复，而不是拿一个空版本号去 prepare。 */
/**
 * @param {string} [root]
 * @returns {string | null}
 */
export function packageManagerVersion(root = process.cwd()) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const match = /^pnpm@(\S+)$/.exec(String(pkg.packageManager ?? ""));
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** 探测结果的原因 → 用户能照做的短句（只描述现象，不替用户下因果结论）。 */
/** @type {Record<string, string>} */
const PROBE_REASONS = {
  "spawn-error": "命令起不来（可执行形态/权限不对）",
  "no-version": "命令能起，但没打印版本号",
  "exit-nonzero": "命令报错退出",
  "not-found": "PATH 上找不到命令",
};

/** 短句表里没有的键一律回落到「未知」—— 新增原因时不至于把 undefined 印给用户。 */
/** @param {ProbeReason | string} key @returns {string} */
function reasonText(key) {
  return PROBE_REASONS[key] ?? "未知";
}

/**
 * 跑一次 `pnpm -v` 并给出**结构化**结论。
 *
 * 关键点：`probe.error` 与「退出码非 0」是两回事，此前只有一句
 * `exit=${status ?? "?"}`：命令压根没起来时 status 是 null，于是所有失败都塌成
 * 「exit=?」加一句「未知错误」。这里把 `probe.error.code`（EACCES / ENOENT /
 * ENOEXEC…）与命令回显的 stderr 一起带出来，用户第一眼就能分清
 * 「选错了可执行文件」还是「pnpm 自己坏了」。
 *
 * @param {ProbeOptions} [options]
 * @returns {ProbeResult}
 */
export function probePnpm({ root = process.cwd(), env = process.env, platform = process.platform } = {}) {
  const candidate = whichCommand("pnpm", { env, platform });
  if (!candidate) {
    return failed(null, "not-found", "", null);
  }
  return probeCommand(candidate, { root, env, platform });
}

/** 用同一条判据探任意命令（`probePnpm` 与 corepack 复核共用）。 */
/**
 * @param {string} candidate
 * @param {ProbeOptions & { args?: string[] }} [options]
 * @returns {ProbeResult}
 */
export function probeCommand(candidate, { root = process.cwd(), env = process.env, args = ["-v"] } = {}) {
  /** 注入的 env 可能是更宽的 Record（测试里常只给 PATH），这里统一成 spawn 认的形状。 */
  const spawnEnv = /** @type {NodeJS.ProcessEnv} */ (env);
  // 形态与回退由 usableCommand 决定（shebang shim 会换成 `powershell -File <name>.ps1`），
  // 本模块不自己判断平台后缀 —— 那是 shell.mjs 的单一判据。
  const { command, prefixArgs } = commandInvocation(candidate, args);
  const probe = spawnSync(command, [...prefixArgs, ...args], {
    cwd: root,
    env: spawnEnv,
    encoding: "utf8",
    timeout: PROBE_TIMEOUT_MS,
    windowsHide: true,
  });
  /** `spawnSync` 的 error 是 Error 的运行时子类（`code` 由 libuv 填）。 */
  const error = /** @type {NodeJS.ErrnoException | undefined} */ (probe.error);
  if (error?.code) {
    return failed(command, "spawn-error", `${error.code}（${usableReason(candidate, args)}）`, null);
  }
  const output = `${probe.stdout ?? ""}${probe.stderr ?? ""}`;
  const version = /(\d+\.\d+[\w.-]*)/.exec(output)?.[1] ?? null;
  if (probe.status !== 0) {
    return failed(command, "exit-nonzero", firstLines(output), probe.status ?? null);
  }
  if (!version) {
    return failed(command, "no-version", firstLines(output), probe.status ?? null);
  }
  return {
    ok: true,
    command,
    version,
    reason: "ok",
    reasonText: "可用",
    detail: version,
    exitCode: probe.status ?? 0,
  };
}

/** `usableCommand` 给出的「为什么这个候选起不来」，附在 spawn-error 后面。 */
/** @param {string} candidate @param {string[]} args @returns {string} */
function usableReason(candidate, args) {
  const usable = commandInvocation(candidate, args);
  return usable.command === candidate ? "未发现可回退形态" : `已回退到 ${path.basename(usable.command)}`;
}

/** 统一的失败返回，保证字段齐全（调用方不必到处判 undefined）。 */
/** @param {string | null} command @param {ProbeReason} reason @param {string} detail
 *  @param {number | null} exitCode @returns {ProbeResult} */
function failed(command, reason, detail, exitCode) {
  return { ok: false, command, version: null, reason, reasonText: reasonText(reason), detail, exitCode };
}

/** 只留输出的头几行（错误摘要足够，整段栈会顶掉启动页那一行提示）。 */
/** @param {string} output @returns {string} */
function firstLines(output) {
  return String(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
}

/**
 * 用 corepack 重建 pnpm（**版本号取自 package.json**）。
 *
 * `corepack prepare pnpm@<ver> --activate` 是官方给「缓存损坏」的标准修法，
 * 但只有在 corepack 自己能跑时才成立；corepack 本身不可用时**不抛**——
 * 返回 description 让调用方把实测情况原样写进提示（抛出去只会变成另一句「未知错误」）。
 *
 * @param {ProbeOptions & { expected?: string | null }} [options]
 * @returns {{ ran: boolean, ok: boolean, description: string }}
 */
export function preparePnpm({ root = process.cwd(), expected = null, env = process.env, platform = process.platform } = {}) {
  const spawnEnv = /** @type {NodeJS.ProcessEnv} */ (env);
  const version = expected ?? packageManagerVersion(root);
  if (!version) {
    return { ran: false, ok: false, description: "package.json 未声明 pnpm 版本，跳过自动重建" };
  }
  const candidate = whichCommand("corepack", { env, platform });
  if (!candidate) {
    return { ran: false, ok: false, description: "PATH 上找不到 corepack，无法自动重建 pnpm" };
  }
  const { command, prefixArgs } = commandInvocation(candidate, ["--version"]);
  const result = spawnSync(command, [...prefixArgs, "prepare", `pnpm@${version}`, "--activate"], {
    cwd: root,
    env: spawnEnv,
    encoding: "utf8",
    timeout: PREPARE_TIMEOUT_MS,
    windowsHide: true,
  });
  const error = /** @type {NodeJS.ErrnoException | undefined} */ (result.error);
  if (error?.code) {
    return { ran: true, ok: false, description: `corepack 起不来（${error.code}）` };
  }
  if (result.status !== 0) {
    const tail = firstLines(`${result.stdout ?? ""}${result.stderr ?? ""}`);
    return { ran: true, ok: false, description: `corepack prepare 失败（exit=${result.status ?? "?"}${tail ? "：" + tail : ""}）` };
  }
  return { ran: true, ok: true, description: `corepack 已重建 pnpm@${version}` };
}

/**
 * 修复 + **复核**：prepare 之后必须用 `probePnpm()` 再验一次「真的能用了」。
 *
 * 这一步不是装饰：corepack prepare 的退出码只说明「下载/激活动作完成」，
 * 而用户真正的诉求是 `pnpm -v` 能返回版本号 —— 两者在「shim 仍不可执行」
 * 这类现场里恰好相反（prepare 成功、pnpm 依旧起不来）。只报 prepare 成功
 * 等于把「修好了」当成结论，用户下一次启动会原封不动地再撞一次。
 *
 * @param {ProbeOptions} [options]
 * @returns {{ repaired: boolean, pre: ProbeResult, prepare: { ran: boolean, ok: boolean, description: string },
 *             post: ProbeResult, before: string | null, after: string | null }}
 */
export function repairPnpm({ root = process.cwd(), env = process.env, platform = process.platform } = {}) {
  const pre = probePnpm({ root, env, platform });
  if (pre.ok) {
    return { repaired: false, pre, prepare: { ran: false, ok: true, description: "无需重建" }, post: pre, before: pre.version, after: pre.version };
  }
  const prepare = preparePnpm({ root, env, platform });
  const post = probePnpm({ root, env, platform });
  return { repaired: post.ok, pre, prepare, post, before: pre.version, after: post.version };
}

/**
 * 「这次要不要自动重建」的判据（供启动编排器接线）。
 *
 * 只有 `spawn-error` 一类**看起来就是缓存/可执行形态坏了**的原因才值得重建：
 * `no-version` / `exit-nonzero` 往往是 pnpm 自己在报业务错误（工作区配置、
 * 磁盘权限），重建一遍 pnpm 既治不好、还会多花几分钟下载。
 *
 * @param {Pick<ProbeResult, "ok" | "reason">} probe
 * @returns {boolean}
 */
export function shouldRepair(probe) {
  return !probe.ok && (probe.reason === "spawn-error" || probe.reason === "not-found");
}

/**
 * 启动编排器接线的**唯一入口**：探测 → （必要时）重建 → 复核 → 返回结论与
 * 可行动提示。编排器只负责把 `tip` 记进日志 / launch-status / 启动页横幅。
 *
 * @param {ProbeOptions & { autoRepair?: boolean }} [options]
 * @returns {{ probe: ProbeResult, repaired: boolean, tip: string | null,
 *             repairable: boolean, expected: string | null }}
 */
export function orchestratePnpm({ root = process.cwd(), env = process.env, platform = process.platform, autoRepair = true } = {}) {
  const expected = packageManagerVersion(root);
  const probe = probePnpm({ root, env, platform });
  if (probe.ok) return { probe, repaired: false, tip: null, repairable: false, expected };

  if (autoRepair && shouldRepair(probe)) {
    const repair = repairPnpm({ root, env, platform });
    if (repair.repaired) {
      return {
        probe: repair.post,
        repaired: true,
        repairable: false,
        expected,
        tip: `pnpm 之前起不来（${repair.pre.reasonText}），已用 corepack 重建为 pnpm@${repair.post.version} 后恢复。`,
      };
    }
    return {
      probe: repair.post,
      repaired: false,
      repairable: true,
      expected,
      tip: buildTip(repair.post, {
        expected,
        extra: `${repair.pre.reasonText} → ${repair.post.reasonText}；${repair.prepare.description}`,
      }),
    };
  }

  return {
    probe,
    repaired: false,
    repairable: probe.reason === "spawn-error" || probe.reason === "not-found",
    expected,
    tip: buildTip(probe, { expected, extra: null }),
  };
}

/**
 * 可行动提示（**版本号解析自 package.json**，不再留 `<项目版本>` 占位符）。
 *
 * 文案里刻意保留「你看到的是现象，不是结论」：探测失败既可能来自 corepack 缓存，
 * 也可能来自 PATH 上选中的那个 shim 起不来（Issue #576）。把两句话分开写，
 * 用户照第二条处置时不会先去删缓存。
 *
 * @param {ProbeResult} probe
 * @param {{ expected?: string | null, extra?: string | null }} [context]
 * @returns {string}
 */
export function buildTip(probe, { expected = null, extra = null } = {}) {
  const parts = [];
  const where = probe.command ? `（命令：${probe.command}）` : "";
  parts.push(`pnpm 不可用：${probe.reasonText}${probe.detail ? ` —— ${probe.detail}` : ""}${where}`);
  if (extra) parts.push(`实测经过：${extra}`);
  parts.push("");
  parts.push("修复（按顺序试，改完重启应用）：");
  const prepareCmd = expected ? `corepack prepare pnpm@${expected} --activate` : "corepack prepare --activate";
  if (probe.reason === "not-found") {
    parts.push(`  1. 先开启 pnpm：corepack enable（版本由 package.json 钉死，无需手动指定）`);
    parts.push(`  2. 仍不可用时重建：${prepareCmd}`);
  } else {
    parts.push(`  1. 重建 pnpm（版本取自 package.json）：${prepareCmd}`);
    parts.push("     仍不行就删掉损坏的缓存目录后重装 Node（corepack 缓存位于 Node 安装目录旁的 corepack/ 下）。");
  }
  parts.push(
    "  3. 若命令本身能跑、只是被选错了：检查 PATH 上是否同时存在多个 pnpm 形态" +
      "（.cmd / .ps1 / 无扩展名 shim），让可执行的那个排在前面。" +
      "自查：pnpm check:toolchain（会打印选中的命令与探测结果）。",
  );
  return parts.join("\n");
}
