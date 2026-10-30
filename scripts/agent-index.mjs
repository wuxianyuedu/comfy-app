#!/usr/bin/env node
/**
 * agent-index.mjs —— 两个代码索引工具（codegraph / zvec-grep）的**就绪读数入口**（ISSUE #2762）。
 *
 * ── 为什么要有这一层 ──────────────────────────────────────────────────────
 *
 * `.mcp.json` 声明了这两个本地 MCP（用法见 project Skill
 * `.qoder/skills/code-navigation/SKILL.md`），但它们的索引是**每台机器各自的缓存**：
 * 新检出 / 换机器 / 清过一次目录之后，语义查询**返回空而不报错**。于是「查不到」
 * 会被读成「仓库里没有现成实现」—— 而硬规则 24 的复用优先恰恰靠这个结论下判断。
 *
 * 这个入口只做一件事：**把两个工具自己的读数原样交出来**（能不能用、索引了多少
 * 文件、上次建是什么时候），让「这次检索到底可不可信」有一处可读的回答。
 * 它**不判**索引好不好、不替代 Grep / Read 的复核，也不是门禁（硬规则 24：
 * 查不到 ≠ 不存在；门禁判据仍只在 `scripts/check-*.cjs` 与 `.githooks/pre-commit`）。
 *
 * ── 三条形状约定（硬规则 27 的「四条不许」在本入口上的落法）──
 *
 *   · **不另立判定**：就绪与否只取自执行者原值 —— codegraph 取 `codegraph status -j`
 *     的 `initialized`，zvec-grep 取 `zg status --check-ready` 的退出码（它自己
 *     「preserves the normal output and exits non-zero unless ready」）；本文件不猜
 *     「文件数够不够」「上次索引是不是太久」；
 *   · **缺席不许读成通过**：工具不在 PATH / 读数解析不了 ⇒ 退 2（没有结论），
 *     并把它自己的 stderr 原样转出来；退 0 只在**两个工具都明确报就绪**时给出；
 *   · **不吞 stderr**：两个工具的每条原始输出都带前缀转发，尤其 `zg index` 在
 *     embedding provider 未配置时只在 stderr 里说话。
 *
 * 默认**只读**：一个字节都不往索引里写。建索引要人点名 `--init`（`zg index` 牵
 * embedding provider 与凭据，选哪种由人决定，本入口不替人选）。
 *
 * 用法：
 *   pnpm agent:index          只读诊断：两个工具各自报什么就印什么
 *   pnpm agent:index --init   未建索引的就地建起来，随后**重新取一遍**状态再报
 *
 * 退出码：0 = 两个工具都报就绪；1 = 有工具明确报「没就绪」；2 = 没结论
 * （工具不在 / 读数解析不了）—— 2 不是绿，也不是「索引坏了」。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const TAG = "[agent:index]";

/** 两个工具各自的「装在哪、索引在哪、MCP 那一面怎么起」——报缺席时一并给出口。 */
const TOOLS = {
  codegraph: {
    install: "pnpm add -g @colbymchenry/codegraph",
    indexDir: ".codegraph",
    mcp: "codegraph serve --mcp",
  },
  zg: {
    install: "pnpm add -g @zvec/zvec-grep",
    indexDir: ".zvec-grep",
    mcp: "zg server --stdio",
  },
};

/**
 * 跑一个外部命令，原样带回 stdout / stderr / 退出码。
 *
 * Windows 上全局安装的 pnpm 包是**无扩展名 shim + `.cmd` / `.ps1` 三件套**，
 * `spawnSync("codegraph", …)` 不带 shell 会 ENOENT；带 `{shell: true}` 又会打出
 * DEP0190。这里走 `cmd.exe /d /s /c`（参数都是简单词，不经过引号拼接）。
 *
 * @param {string} cmd
 * @param {string[]} args
 * @returns {{missing: boolean, code: number | null, stdout: string, stderr: string}}
 */
export function runTool(cmd, args) {
  const res =
    process.platform === "win32"
      ? spawnSync("cmd.exe", ["/d", "/s", "/c", cmd, ...args], {
          cwd: ROOT,
          encoding: "utf8",
        })
      : spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  /* 「命令不在」有两种形状：POSIX 的 spawn ENOENT，与 cmd.exe 回显的
   * 「'x' is not recognized …」。两种都是**没取到读数**，不是「没就绪」。
   * `SpawnSyncReturns.error` 的静态类型是 `Error`，`code` 只在运行期由 libuv 挂上来。 */
  const missing =
    /** @type {{code?: string} | undefined} */ (res.error)?.code === "ENOENT" ||
    (process.platform === "win32" &&
      /is not recognized as an internal or external command/i.test(stderr));
  return {
    missing,
    code: typeof res.status === "number" ? res.status : null,
    stdout,
    stderr,
  };
}

/**
 * 两段输出合成一份（保留先后：有些工具把结论写在 stderr 之前）。
 *
 * @param {{stdout: string, stderr: string}} res
 * @returns {string}
 */
function combined(res) {
  return `${res.stdout}${res.stderr}`;
}

/**
 * 原始输出按行加前缀印出；空输出就明说「它什么都没说」。
 *
 * @param {string[]} lines
 * @param {{stdout: string, stderr: string}} res
 */
function relay(lines, res) {
  const text = combined(res).replace(/\s+$/, "");
  if (text === "") {
    lines.push("   │ （它没有输出）");
    return;
  }
  for (const line of text.split("\n")) lines.push(`   │ ${line}`);
}

/**
 * 探 codegraph。就绪只认它自己 `initialized` 这个布尔值。
 *
 * 未建索引时 `codegraph status -j` **退出码仍是 0**（只把 `initialized` 写成 false），
 * 所以这里不拿退出码当结论；JSON 解析失败 / 字段缺失才算「没取到读数」。
 *
 * @param {typeof runTool} [run] 取数方式（用例注入用；缺省就是真的去跑命令）
 * @returns {{id: "codegraph", verdict: "ready" | "not-ready" | "unknown", data?: Record<string, unknown>, res: ReturnType<typeof runTool>, reason?: string}}
 */
export function probeCodegraph(run = runTool) {
  const res = run("codegraph", ["status", "-j"]);
  if (res.missing) {
    return { id: "codegraph", verdict: "unknown", res, reason: "命令不在 PATH 里" };
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    /* 不是 JSON ⇒ parsed 保持 undefined，下面按「取不到读数」处理。 */
  }
  const data =
    typeof parsed === "object" && parsed !== null
      ? /** @type {Record<string, unknown>} */ (parsed)
      : null;
  if (res.code !== 0 || !data || typeof data.initialized !== "boolean") {
    return {
      id: "codegraph",
      verdict: "unknown",
      res,
      reason: `\`codegraph status -j\` 没给出可解析的状态（退出码 ${res.code ?? "null"}）`,
    };
  }
  return {
    id: "codegraph",
    verdict: data.initialized ? "ready" : "not-ready",
    data,
    res,
  };
}

/**
 * 探 zvec-grep。就绪只认 `zg status --check-ready` 的退出码 —— 那一档同样是它
 * 自己的原话（「exits non-zero unless the Workspace index is ready」），并且
 * 它**同时保留正常输出**，文件数 / 刷新状态都在里面。
 *
 * 非零退出但输出里没有它那句「not ready」⇒ 这不是「没就绪」，是别的故障：
 * 归到「没结论」，把它说的话原样转出来让人看。
 *
 * @param {typeof runTool} [run] 取数方式（用例注入用；缺省就是真的去跑命令）
 * @returns {{id: "zg", verdict: "ready" | "not-ready" | "unknown", res: ReturnType<typeof runTool>, reason?: string}}
 */
export function probeZvec(run = runTool) {
  const res = run("zg", ["status", "--check-ready"]);
  if (res.missing) {
    return { id: "zg", verdict: "unknown", res, reason: "命令不在 PATH 里" };
  }
  if (res.code === 0) return { id: "zg", verdict: "ready", res };
  if (/not ready/i.test(combined(res))) {
    return { id: "zg", verdict: "not-ready", res };
  }
  return {
    id: "zg",
    verdict: "unknown",
    res,
    reason: `\`zg status --check-ready\` 退出码 ${res.code ?? "null"}，但输出里没有它自己的「没就绪」说法`,
  };
}

/**
 * 缺省值的形状统一成一句短话（读数缺失时别印成 0）。
 *
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function show(value, fallback = "（未给）") {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

const VERDICT_LABEL = {
  ready: "就绪",
  "not-ready": "没就绪",
  unknown: "没取到读数",
};

const VERDICT_CODE = { ready: 0, "not-ready": 1, unknown: 2 };

/**
 * 把一个探针读数渲染成人读的几行。
 *
 * @param {{id: string, verdict: "ready" | "not-ready" | "unknown", data?: Record<string, unknown>, res: ReturnType<typeof runTool>, reason?: string}} probe
 * @returns {string[]}
 */
export function renderProbe(probe) {
  const tool = TOOLS[/** @type {"codegraph" | "zg"} */ (probe.id)];
  const lines = [];
  lines.push(`${TAG} ${probe.id}：${VERDICT_LABEL[probe.verdict]}`);
  if (probe.id === "codegraph" && probe.data) {
    const d = probe.data;
    const index =
      typeof d.index === "object" && d.index !== null
        ? /** @type {Record<string, unknown>} */ (d.index)
        : {};
    lines.push(
      `   · 版本 ${show(d.version)} · 索引目录 ${show(d.indexPath)}`,
      `   · 上次建索引 ${show(d.lastIndexed, "（还没建过）")}`,
    );
    /* 未建索引时这几格整段缺席（读数是 null）—— 整行「（未给）」只是噪声。 */
    if (typeof d.fileCount === "number") {
      lines.push(
        `   · 文件 ${show(d.fileCount)} · 节点 ${show(d.nodeCount)} · 边 ${show(d.edgeCount)}`,
        `   · 索引状态 ${show(index.state)} · 待处理变更 ${show(d.pendingChanges)} · 建议重建 ${show(d.reindexRecommended)}`,
      );
    }
  }
  if (probe.id === "zg") {
    /* zvec-grep 的文件数 / 刷新状态只写在它自己的输出里，转出来、不另算。 */
    relay(lines, probe.res);
  }
  if (probe.reason) lines.push(`   · ${probe.reason}`);
  if (probe.verdict === "unknown") {
    lines.push(`   · 装法（若它确实没装）：${tool.install} · MCP 面：${tool.mcp}`);
    if (probe.id === "codegraph") relay(lines, probe.res);
  }
  if (probe.verdict === "not-ready") {
    lines.push(`   · 索引目录：${path.join(ROOT, tool.indexDir)}（本机缓存，不入库）`);
  }
  return lines;
}

/**
 * 汇总两个读数：2（没结论）压过 1（没就绪）压过 0（都就绪）。
 *
 * @param {Array<{verdict: "ready" | "not-ready" | "unknown"}>} probes
 * @returns {number}
 */
export function combineVerdicts(probes) {
  let total = 0;
  for (const p of probes) total = Math.max(total, VERDICT_CODE[p.verdict]);
  return total;
}

/**
 * 把两个探针的读数印成一份报告（诊断与 `--init` 之后共用同一条出口）。
 *
 * @param {Array<ReturnType<typeof probeCodegraph> | ReturnType<typeof probeZvec>>} probes
 * @param {{afterInit?: boolean}} [opts]
 */
function report(probes, opts = {}) {
  const out = [];
  out.push(
    opts.afterInit
      ? `${TAG} 下面是**重新取一遍**的读数（\`--init\` 之后不沿用建索引前那一份）：`
      : `${TAG} 只读诊断（不改任何索引）—— 状态全部取自两个工具自己的读数：`,
  );
  for (const p of probes) out.push(...renderProbe(p));
  const total = combineVerdicts(probes);
  const state = total === 0 ? "ok" : total === 1 ? "red" : "skip";
  out.push(
    `${TAG} 结论：${
      state === "ok"
        ? "两个工具都报就绪 —— 这两条检索通道现在可用"
        : state === "red"
          ? "有工具明确报**没就绪** —— 现在不能把它的空结果当「仓库里没有」"
          : "**没取到读数**（工具不在 / 输出解析不了）—— 这一档不是绿，也不是「索引坏了」"
    }`,
    `${TAG} 边界：索引只是导航加速，不替代 Grep / Read 复核，也不替代门禁（硬规则 24：查不到 ≠ 不存在）。`,
  );
  if (total !== 0) {
    out.push(
      `${TAG} 下一步：\`pnpm agent:index --init\` 把没建的索引就地建起来（zvec-grep 的 embedding provider 仍由人决定）；` +
        "工具本身不在 PATH 就先按上面那行装法装上。",
    );
  }
  for (const line of out) process.stdout.write(`${line}\n`);
  return total;
}

/**
 * `--init`：只对**明确报「没就绪」**的工具动手，然后重新探一遍。
 *
 * 已有索引的工具一个字节都不动（重建是 `codegraph sync` / `codegraph index` 的事，
 * 属于各自的维护动作，本入口不替它们猜「要不要重建」）。
 *
 * @param {Array<ReturnType<typeof probeCodegraph> | ReturnType<typeof probeZvec>>} before
 */
function initialize(before) {
  for (const p of before) {
    if (p.verdict !== "not-ready") {
      if (p.verdict === "unknown") {
        process.stdout.write(
          `${TAG} ${p.id}：没取到读数，不试着建索引（先把工具装好 / 让输出可解析，见下面那份诊断）\n`,
        );
      } else {
        process.stdout.write(`${TAG} ${p.id}：已经报就绪，不再动它\n`);
      }
      continue;
    }
    const [cmd, args] =
      p.id === "codegraph"
        ? ["codegraph", ["init", "--yes"]]
        : ["zg", ["index"]];
    process.stdout.write(`${TAG} 跑 \`${cmd} ${args.join(" ")}\`：\n`);
    const res = runTool(cmd, args);
    /** @type {string[]} */
    const lines = [];
    relay(lines, res);
    for (const line of lines) process.stdout.write(`${line}\n`);
    if (res.code !== 0) {
      process.stdout.write(
        `${TAG} 它没跑成（退出码 ${res.code ?? "null"}）—— 上面是它自己的原话；` +
          "建不出来这件事照实记，不在这里替它改名成「已就绪」\n",
      );
    }
    if (p.id === "zg") {
      process.stdout.write(
        `${TAG} 注：\`zg index\` 若报缺 embedding provider，那是**由人选**的形态（\`zg config\` / \`zg auth status\` 自查），本入口不替你选\n`,
      );
    }
  }
}

/**
 * @param {string[]} [argv]
 * @returns {number} 退出码
 */
export function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      "用法：\n" +
        "  pnpm agent:index          只读诊断（默认）\n" +
        "  pnpm agent:index --init   未建索引的就地建起来，随后重新取一遍状态\n" +
        "退出码：0 = 两个工具都报就绪；1 = 有工具明确报没就绪；2 = 没取到读数（不是绿）\n",
    );
    return 0;
  }
  const unknown = argv.filter((a) => a !== "--init");
  if (unknown.length > 0) {
    process.stderr.write(
      `${TAG} 不认识的参数：${unknown.join(" / ")} —— 本入口只认 --init；` +
        "拼错的旗标不会生效，退 2 表示这次什么都没查（不是「已就绪」）\n",
    );
    return 2;
  }
  const probes = [probeCodegraph(), probeZvec()];
  if (argv.includes("--init")) {
    initialize(probes);
    return report([probeCodegraph(), probeZvec()], { afterInit: true });
  }
  return report(probes);
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === import.meta.filename
) {
  process.exit(main());
}
