/**
 * `quality-gate` 两份实现（`scripts/quality-gate.mjs` / `.ps1`）门禁表的唯一解析器（§12.18）：
 * 不能 import（`.mjs` 末尾 `process.exit(main())`，等于真跑一遍门禁），只能读源码形状；消费方
 * `tests/ps1-consistency.test.ts` 比对两侧集合；判据按入口脚本认档而非名字（改名即可绕过）。
 */

import { stripComments } from "./strip-comments";

/** 一条门禁在某一侧的形状。 */
export type GateEntry = {
  /** 入口脚本体现在 `args` 里出现的那些路径（`../scripts/x.mjs` 形态，未归一化）。 */
  args: Array<string>;
  /** 门禁名（两侧应当一致）。 */
  name: string;
  /** 只在该侧**显式点名**时才跑（`.mjs` 的 `run: false` / `.ps1` 的 `Run = $false`）。 */
  onDemand: boolean;
};

/**
 * 去注释再解析：不剥会咬到「解释这档为什么进不了 `all`」的 JSDoc，同一段文字既当文档又被当登记
 * （实测：注释里提到另一个入口脚本就会认错档）。走 `strip-comments` 共享件（ISSUE #2969）——
 * 原内联两条 replaceAll 会把字符串里的注释起点吃掉、把 `http://…` 截断。
 */
function stripForParsing(src: string): string {
  return stripComments(stripComments(src, { syntax: "hash" }), { trailing: true });
}

/**
 * 从 `.ps1` 源码取门禁块：按块（`@{ … }`）切分，不按行或前瞻 —— 注释独占行、块可跨行，
 * 前瞻正则会在换行/注释/块尾静默取错（实测第一版把 `typecheck` 当成按需档）；名字取不到的不返回。
 * @param src `scripts/quality-gate.ps1` 全文  @returns 每块一条（形状不认识的跳过）
 */
export function parsePs1Gates(src: string): Array<GateEntry> {
  // **只在 `$Blocks` 数组里找**（与 `.mjs` 侧只在 `GATES` 里找同一条纪律）。
  // 不划范围会咬到两处：文件头的「怎么加一条门禁」示例块（`@{ Name="id"; … }`）与
  // 下面 `Get-*Drift` 那几个返回 `@{ state = …; report = … }` 的哈希表 ——
  // 前者会在默认档里凭空多出一条 `id`（实测就是这条把两个平台的默认档集合判成了不等）。
  const start = src.indexOf("$Blocks = @(");
  const end = start === -1 ? -1 : src.indexOf("\n)", start);
  if (start === -1 || end < 0) {
    return [];
  }
  const region = src.slice(start, end);
  const blocks = [...region.matchAll(/@\{(?<block>[\s\S]*?)\}/g)].map((m) =>
    stripForParsing(m.groups?.block ?? ""),
  );
  return blocks
    .map((block) => ({
      name: /Name\s*=\s*"(?<gateName>[A-Za-z0-9_]+)"/.exec(block)?.groups?.gateName ?? "",
      args: [...block.matchAll(/"(?<scriptPath>[^"]*\.(?:mjs|cjs|js))"/g)].map(
        (m) => m.groups?.scriptPath ?? "",
      ),
      onDemand: /Run\s*=\s*\$false\b/.test(block),
    }))
    .filter((e) => e.name.length > 0);
}

/**
 * 从 `.mjs` 的 `GATES` 块取门禁项：每项从 `  key: {` 到下一个 `  key: {`（或收尾 `};`）为止，
 * 与 `ps1-consistency` 的口径逐字一致。
 * @param src `scripts/quality-gate.mjs` 全文  @returns 每项一条
 */
export function parseMjsGates(src: string): Array<GateEntry> {
  const start = src.indexOf("const GATES = {");
  const end = src.indexOf("function parseArgs");
  if (start === -1 || end === -1 || end < start) {
    return [];
  }
  const block = src.slice(start, end);
  return [
    ...block.matchAll(
      /^ {2}(?<gate>[A-Za-z0-9_]+): \{(?<body>[\s\S]*?)(?=^ {2}[A-Za-z0-9_]+: \{|^\};)/gm,
    ),
  ].map((m) => {
    const body = stripForParsing(m.groups?.body ?? "");
    const argsLiteral = /args:\s*\[(?<args>[^\]]*)\]/.exec(body)?.groups?.args ?? "";
    return {
      name: m.groups?.gate ?? "",
      args: [...argsLiteral.matchAll(/"(?<arg>[^"]*)"/g)].map((x) => x.groups?.arg ?? ""),
      onDemand: /\brun:\s*false\b/.test(body),
    };
  });
}

/**
 * 按入口脚本文件名取那一档（不按名字，理由见文件头）：只在唯一命中时返回它；0 条或多条返回 `null` ——
 * 「按入口找不到」正是判据要看见的形状（改名/删档/入口挪位即此），而不是让调用方拿 `undefined` 静默跳过。
 * @param gates 某一侧解析的门禁  @param scriptName 入口文件名，如 `shell-gate.mjs`  @returns 唯一命中或 null
 */
export function gateByEntry(gates: Array<GateEntry>, scriptName: string): GateEntry | null {
  // `.ps1` 里的路径写的是反斜杠（`scripts\\shell-gate.mjs`），`.mjs` 里是正斜杠 ——
  // 先把两侧归一到 `/` 再比：不归一的表现是「同一档在一侧找得到、另一侧找不到」，
  // 而那会被读成「这一档没登记」，与实际相反。
  const hits = gates.filter((g) =>
    g.args.some((a) => {
      const norm = a.replaceAll("\\", "/");
      return norm === scriptName || norm.endsWith(`/${scriptName}`);
    }),
  );
  return hits.length === 1 ? (hits[0] ?? null) : null;
}
