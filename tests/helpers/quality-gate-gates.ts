/**
 * `quality-gate` 两份实现（`scripts/quality-gate.mjs` / `scripts/quality-gate.ps1`）
 * 里那张门禁表的**唯一一份解析器**（§12.18 复用优先）。
 *
 * 为什么要解析而不是 import：`quality-gate.mjs` 末尾是 `process.exit(main())`，
 * import 它等于**真跑一遍门禁**（起 pnpm、跑 vitest），用例里不可能这么做。所以
 * 「这一档登记成什么」只能从源码形状上读 —— 与 `tests/ps1-consistency.test.ts`
 * 早已在做的是同一件事，这里把那份内联实现收成共享件。
 *
 * 两个消费方（都是判据，各自钉不同的东西）：
 *   · `tests/ps1-consistency.test.ts` —— 两侧的**门禁名集合**是否一致（增减只改一侧）；
 *   · `tests/pixel-run.test.ts` —— 像素档**是否留在按需层**（规范 §11.8：不进 `check:all`）。
 *
 * ⚠️ 判据要按**入口**（`args` 里那个脚本路径）认那一档，不按名字：改名就能绕过的门禁
 * 等于没有。这一点与 `storybook-check.mjs` 的「不按 `xxxVariants` 命名判」同一条理由。
 *
 * 两份实现的形状（各自的历史都在文件里写着，这里只描述现状）：
 *   · `.mjs`：`GATES` 对象的每一项是 `  key: { … args: ["…"], … run: false, }`；
 *   · `.ps1`：每一项是 `@{ Name = "key"; … Args = @("…"); Run = $false }`，可跨行。
 */

/** 一条门禁在某一侧的形状。 */
export interface GateEntry {
  /** 门禁名（两侧应当一致）。 */
  name: string;
  /** 入口脚本体现在 `args` 里出现的那些路径（`../scripts/x.mjs` 形态，未归一化）。 */
  args: string[];
  /** 只在该侧**显式点名**时才跑（`.mjs` 的 `run: false` / `.ps1` 的 `Run = $false`）。 */
  onDemand: boolean;
}

/**
 * 去掉注释再解析 —— 不剥注释会咬到「解释这条门禁为什么不进 `all`」的那些 JSDoc，
 * 于是同一段文字既是文档又被当成登记（实测：`storybook` 那一项的注释里提到了
 * `pixel-run.mjs`，不剥就会把 `storybook` 也认成像素档）。
 *
 * 与 `tests/helpers/strip-comments.ts` 的取舍一致（块注释整段去、行注释只去整行的），
 * 但**不复用那一份**：那一份是「拿正则断言源码形状」的门禁专用（有台账管着副本数），
 * 而这里要的是「剥到能解析对象字面量」—— 多一步把行内 `//` 之后的说明去掉。
 * 只在本文件出现一次，不构成第二处实现。
 */
function stripForParsing(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/^\s*#[^\n]*$/gm, "");
}

/**
 * 从 `.ps1` 源码里取出门禁块。
 *
 * 按**块**切分（`@{ … }`）而不是按行或前瞻：`.ps1` 的注释单独占行（`# …`）、
 * 块可跨行，用前瞻式正则会在「换行 / 注释 / 块尾形态」上静默取错 ——
 * `ps1-consistency` 的历史注释记着实测第一版就把 `typecheck` 当成了按需档。
 *
 * @param src `scripts/quality-gate.ps1` 的全文
 * @returns 每一块一条；名字取不到（形状不认识）的不返回
 */
export function parsePs1Gates(src: string): GateEntry[] {
  // **只在 `$Blocks` 数组里找**（与 `.mjs` 侧只在 `GATES` 里找同一条纪律）。
  // 不划范围会咬到两处：文件头的「怎么加一条门禁」示例块（`@{ Name="id"; … }`）与
  // 下面 `Get-*Drift` 那几个返回 `@{ state = …; report = … }` 的哈希表 ——
  // 前者会在默认档里凭空多出一条 `id`（实测就是这条把两个平台的默认档集合判成了不等）。
  const start = src.indexOf("$Blocks = @(");
  const end = start < 0 ? -1 : src.indexOf("\n)", start);
  if (start < 0 || end < 0) return [];
  const region = src.slice(start, end);
  const blocks = [...region.matchAll(/@\{([\s\S]*?)\}/g)].map((m) =>
    stripForParsing(m[1] ?? ""),
  );
  return blocks
    .map((block) => ({
      name: /Name\s*=\s*"([A-Za-z0-9_]+)"/.exec(block)?.[1] ?? "",
      args: [...block.matchAll(/"([^"]*\.(?:mjs|cjs|js))"/g)].map(
        (m) => m[1] ?? "",
      ),
      onDemand: /Run\s*=\s*\$false\b/.test(block),
    }))
    .filter((e) => e.name.length > 0);
}

/**
 * 从 `.mjs` 源码的 `GATES` 块里取出门禁项。
 *
 * 每一项从 `  key: {` 到下一个 `  key: {`（或块的收尾 `};`）为止 —— 与
 * `ps1-consistency` 的同名口径逐字一致（那里先用的就是这个正则）。
 *
 * @param src `scripts/quality-gate.mjs` 的全文
 * @returns 每一项一条
 */
export function parseMjsGates(src: string): GateEntry[] {
  const start = src.indexOf("const GATES = {");
  const end = src.indexOf("function parseArgs");
  if (start < 0 || end < 0 || end < start) return [];
  const block = src.slice(start, end);
  return [
    ...block.matchAll(
      /^ {2}([A-Za-z0-9_]+): \{([\s\S]*?)(?=^ {2}[A-Za-z0-9_]+: \{|^\};)/gm,
    ),
  ].map((m) => {
    const body = stripForParsing(m[2] ?? "");
    const argsLiteral = /args:\s*\[([^\]]*)\]/.exec(body)?.[1] ?? "";
    return {
      name: m[1] ?? "",
      args: [...argsLiteral.matchAll(/"([^"]*)"/g)].map((x) => x[1] ?? ""),
      onDemand: /\brun:\s*false\b/.test(body),
    };
  });
}

/**
 * 按**入口脚本文件名**取那一档（不按名字，理由见文件头）。
 *
 * 只在**唯一**命中时返回它；0 条或多条时返回 `null` —— 「按入口找不到」正是判据
 * 需要看见的形状（改名 / 删档 / 入口挪位都会变成它），而不是让调用方拿到 `undefined`
 * 再静默跳过断言。
 *
 * @param gates 某一侧解析出来的门禁
 * @param scriptName 入口脚本的文件名，如 `pixel-run.mjs`
 * @returns 唯一命中的那一档；不唯一时 null
 */
export function gateByEntry(
  gates: GateEntry[],
  scriptName: string,
): GateEntry | null {
  // `.ps1` 里的路径写的是反斜杠（`scripts\\pixel-run.mjs`），`.mjs` 里是正斜杠 ——
  // 先把两侧归一到 `/` 再比：不归一的表现是「同一档在一侧找得到、另一侧找不到」，
  // 而那会被读成「这一档没登记」，与实际相反。
  const hits = gates.filter((g) =>
    g.args.some((a) => {
      const norm = a.replace(/\\/g, "/");
      return norm === scriptName || norm.endsWith(`/${scriptName}`);
    }),
  );
  return hits.length === 1 ? (hits[0] ?? null) : null;
}
