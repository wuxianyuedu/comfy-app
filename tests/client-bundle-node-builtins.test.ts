/**
 * 客户端 bundle 不得含 Node-only 模块（ISSUE #317 的 P0 回归）：`log-session-scope.ts` 顶层 `import fs`，被只想用
 * `clampLogTime` 的 `LogProvider.tsx`（"use client"）拖进浏览器 chunk，`/login`、`/workspace` 整页 500（同 #282 / §7.12）。
 * 判据只有一份实现（`scripts/lib-node-only-scan.mjs`，#569 / §18.4）；本文件改为消费其 JSON，并钉住「客户端图能穿过 `"use client"` 边界」的反向验证。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGateRepo, expectGateRan } from "./helpers/gate-repo";

const REPO_ROOT = process.cwd();
const SRC = join(REPO_ROOT, "src");

type Report = {
  clientReachable: Array<{ chain: Array<string>; module: string }>;
  counts: Record<string, number>;
  libOnlyReachable: Array<{ chain: Array<string>; module: string }>;
  unguarded: Array<string>;
};

/** `JSON.parse` 的 `any` 不走不安全断言（B5 清账）：按 Report 的顶层键做浅守卫，
 * 够本文件用（产出方是本仓自己的扫描脚本，键齐即可信）。 */
function isReport(value: unknown): value is Report {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const keys = new Set(Object.keys(value));
  return (["clientReachable", "counts", "libOnlyReachable", "unguarded"] as const).every((k) =>
    keys.has(k),
  );
}

/** 跑一次依赖图分析（实现收在扫描器里，本文件不复制一份 —— 见文件头的归属说明）。 */
function scan(): Report {
  const out = execFileSync(process.execPath, ["scripts/lib-node-only-scan.mjs", "--json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const parsed: unknown = JSON.parse(out);
  if (!isReport(parsed)) {
    throw new Error("lib-node-only-scan 的 JSON 输出形状不对");
  }
  return parsed;
}

/** 去掉注释，避免把注释里提到的 `node:fs` 误判成 import。 */
function stripComments(src: string): string {
  return src.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/^\s*\/\/.*$/gm, "");
}

/**
 * 两枚反向验证探针跑在**夹具树**上（ISSUE #2663）：此前往真实入库文件（`shell-tabs-store.ts` / `query-client.ts`）注
 * `import fs` 再在 `finally` 还原；#2593 只管还原凭据，**管不住读的那一侧** —— vitest 按文件并行，
 * `tests/lib-node-only-declarations.test.ts` 同时扫同一棵真树，写入那一瞬被读成仓库事实（build `cnb-c25-1k62nch99` 报
 * `shell-tabs-store.ts`，不改内容重跑即绿）。独占/串行只调窄窗口；夹具树里写与读不是同一棵。 */
function runScanOnFixture(files: Record<string, string>): Report {
  const { repo, dispose } = createGateRepo({
    script: "lib-node-only-scan.mjs",
    dirs: ["src"],
  });
  try {
    for (const [rel, content] of Object.entries(files)) {
      repo.write(rel, content);
    }
    const r = repo.run(["--json"]);
    /* 先判「跑起来了」再判内容（拿不到测量不是判据红，§13.6.4）；
     * `--json` 那一档恒退 0，所以这一格退非 0 就是夹具或脚本坏了。 */
    expectGateRan(r);
    expect(r.code, r.output).toBe(0);
    const parsed: unknown = JSON.parse(r.output);
    if (!isReport(parsed)) {
      throw new Error("lib-node-only-scan 的 JSON 输出形状不对");
    }
    return parsed;
  } finally {
    dispose();
  }
}

/**
 * 判别位是那个 **lib 侧**的 `"use client"` 入口：入口集若退回「只收 app/components」，
 * 从 `page.tsx` 出发走不到 `src/lib/foo/pure-fs.ts`（它只挂在 lib 侧入口下面），
 * 这一格就红 —— 断的不是「目标被找到」，是「walk 的起点里有没有 lib」。
 */
const LIB_ENTRY_FIXTURE = {
  "src/app/only-shell/page.tsx":
    '"use client";\n\nimport { unrelated } from "~/lib/zzz/unrelated";\n\n' +
    "export default function Page() {\n  return unrelated();\n}\n",
  "src/lib/zzz/unrelated.ts": "export function unrelated() {\n  return 1;\n}\n",
  "src/lib/bar/tabs-entry.ts":
    '"use client";\n\nimport { touchFs } from "~/lib/foo/pure-fs";\n\n' +
    "export const entry = touchFs;\n",
  "src/lib/foo/pure-fs.ts":
    'import fs from "node:fs";\n\nexport function touchFs() {\n' +
    '  return typeof fs.existsSync === "function";\n}\n',
};

/**
 * 判别位是那个**夹在中间**的 `"use client"` 模块：扫描器若把声明当停止点，
 * `page.tsx → react-entry` 这一步就停住，`pure-leaf` 永远不可见 ⇒ 这一格红。
 * （旧扫描器缺的就是这一块 —— 见文件头那两段「两份判据各差一块」。）
 */
const CROSS_CLIENT_FIXTURE = {
  "src/app/x/page.tsx":
    '"use client";\n\nimport { reactEntry } from "~/trpc/react-entry";\n\n' +
    "export default function P() {\n  return reactEntry;\n}\n",
  "src/trpc/react-entry.ts":
    '"use client";\n\nimport { leaf } from "./pure-leaf";\n\n' +
    "export const reactEntry = leaf;\n",
  "src/trpc/pure-leaf.ts":
    'import fs from "node:fs";\n\nexport function leaf() {\n' +
    '  return typeof fs.readFileSync === "function";\n}\n',
};

describe("客户端可达图中不得出现顶层 import Node 内建的模块", () => {
  const report = scan();

  it(
    "全仓扫描为绿（无客户端可达的 Node-only 模块）",
    () => {
      const hits = report.clientReachable;
      const detail = hits
        .map((h) => `  ✗ ${h.module}\n      引用链：${h.chain.join(" -> ")}`)
        .join("\n");
      expect(
        hits,
        `以下模块被客户端组件（或其依赖）静态引用，且顶层 import 了 Node 内建模块——\n` +
          `Turbopack 会以 "does not support external modules" 让整页 500。\n` +
          `修法：把纯逻辑（客户端要用的）与 IO（Node-only）拆成两个文件，\n` +
          `IO 那个放 <name>.server.ts（见 ISSUE #282 / #317 与规范 07 §7.12）。\n${detail}`,
      ).toEqual([]);
    }, // 扫描器要逐文件读盘 + 解析（600+ 模块），全量并行负载下 5s 默认值不够
    30_000,
  );

  it("log-session-scope 已分层：纯函数模块不含 fs，IO 在 .server 模块", () => {
    // 这是本测试要守住的具体回归（ISSUE #317 的 P0）。
    const pure = readFileSync(join(SRC, "lib", "log", "log-session-scope.ts"), "utf8");
    expect(stripComments(pure)).not.toMatch(/from\s+["']node:fs["']/);
    // 纯函数仍可被客户端 import（clampLogTime 是 LogProvider 在用的）
    expect(pure).toContain("export function clampLogTime");
    expect(pure).toContain("export function resolveSessionStart");

    const server = readFileSync(join(SRC, "lib", "log", "log-session-scope.server.ts"), "utf8");
    expect(server).toMatch(/from\s+["']node:fs["']/);
    /**
     * 钉的是「IO 在这一层、以这个名字出口」，不是它同不同步（ISSUE #2193 把它
     * 改成 `async` 之后，原来那条 `toContain("export function fileMtimeMs")`
     * 会在**与契约无关**的形状上红 —— 判据钉语义不钉行形状）。
     */
    expect(server).toMatch(/^export (?:async )?function fileMtimeMs/m);
  });

  it("入口是全 src/** 的 use client（不限于 app/components）", () => {
    /* 真实树里的锚点（只读）：这一形确实存在，判别位不是编出来的。 */
    expect(readFileSync(join(SRC, "lib", "shell", "shell-tabs-store.ts"), "utf8")).toMatch(
      /^\s*["']use client["']/m,
    );

    const report = runScanOnFixture(LIB_ENTRY_FIXTURE);
    const hit = report.clientReachable.find((h) => h.module === "src/lib/foo/pure-fs.ts");
    expect(
      hit,
      '扫描器的客户端入口集没有覆盖 src/lib 下的 "use client" 模块 —— ' +
        "只从 src/app|components 收集入口会漏掉它们（夹具里那个 lib 侧入口就是判别位）。",
    ).toBeDefined();
    /* 链首必须是那个 **lib 侧**入口：只断「目标被找到」的话，
     * 一条从 app 那侧绕过来的路也能把它满足掉，判别位就白设了。 */
    expect(hit?.chain[0]).toBe("src/lib/bar/tabs-entry.ts");
  });

  it("客户端图要能穿过 use client 边界（声明不是边界）", () => {
    // 真实树里的锚点（只读）：`src/trpc/react.tsx` 是 `"use client"`，而
    // `src/trpc/query-client.ts` **只**从它出发才可达。
    expect(readFileSync(join(SRC, "trpc", "react.tsx"), "utf8")).toMatch(/^\s*["']use client["']/m);

    const report = runScanOnFixture(CROSS_CLIENT_FIXTURE);
    const hit = report.clientReachable.find((h) => h.module === "src/trpc/pure-leaf.ts");
    expect(
      hit,
      '扫描器把 "use client" 当成了停止点：夹具里 src/trpc/pure-leaf.ts 只从 ' +
        'src/trpc/react-entry.ts（"use client"）可达，当边界就会漏报。' +
        " 一个永远把 clientReachable 返回空的实现也会红在这里 —— " +
        "这条断言要的正是一次真注入的图。",
    ).toBeDefined();
    expect(hit?.chain.join(" -> ")).toContain("src/trpc/react-entry.ts");
  });
});
