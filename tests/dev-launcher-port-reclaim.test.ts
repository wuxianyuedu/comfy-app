/**
 * 端口残留回收回归护栏（ISSUE #621）：上次 dev server 退出不干净仍听着 `COMFYAPP_PORT`，而 `pidBelongsToRoot`
 * 靠命令行里的检出根路径判定，`pnpm dev -p N` / `pnpm exec next dev --turbo` 都不含它 → 判成「别的程序」只提示不回收。
 * 两层判据（`scripts/launcher-core/orchestrator.mjs`）：`usesExplicitPort()` 显式端口前提 + `portOwnershipVerdict()` 应用服务自证；缺前提不动，宁可放过残留不误杀。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { isRecord, isUnknownArray } from "~/lib/is-record";
import { cmdlineBelongsToRoot, waitForPortsFree } from "../scripts/launcher-core/port-reap.mjs";

const LAUNCHER = JSON.stringify(
  pathToFileURL(join(process.cwd(), "scripts", "dev-launcher.mjs")).href,
);
const ORCH = JSON.stringify(
  pathToFileURL(join(process.cwd(), "scripts", "launcher-core", "orchestrator.mjs")).href,
);
const ROOT = process.cwd();

function join(...parts: Array<string>): string {
  return parts.join("/");
}

/** 在子进程里调真实实现（判据是纯函数，不 mock、不造进程）。 */
function decidePort(script: string): unknown {
  const out = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    cwd: ROOT,
  });
  if (out.status !== 0) {
    throw new Error(out.stderr || out.stdout);
  }
  return JSON.parse(out.stdout);
}

/** 直接问「显式端口 + 这份进程表会得到什么结论」。 */
function verdictFor(
  requestedPort: number | null,
  foreignPids: Array<number>,
  cmds: Record<number, string>,
) {
  const script = `
    import { portOwnershipVerdict } from ${ORCH};
    import { isAppDevServerCmdline } from ${LAUNCHER};
    const cmds = ${JSON.stringify(cmds)};
    const root = ${JSON.stringify(ROOT)};
    const result = await portOwnershipVerdict({
      requestedPort: ${JSON.stringify(requestedPort)},
      verdict: { ownership: "foreign", ownPids: [], foreignPids: ${JSON.stringify(foreignPids)} },
      cmdlineOf: async (pid) => cmds[pid] ?? "",
      isAppProcess: (_pid, cmdline) => isAppDevServerCmdline(cmdline, root),
    });
    process.stdout.write(JSON.stringify(result));
  `;
  /* 读数按 unknown 收窄（B5 清账）：三件（ownership / ownPids / foreignPids）逐一对型。 */
  const parsed: unknown = decidePort(script);
  if (
    !isRecord(parsed) ||
    typeof parsed.ownership !== "string" ||
    !isUnknownArray(parsed.ownPids) ||
    !isUnknownArray(parsed.foreignPids)
  ) {
    throw new Error(`decidePort 的读数形状不对：${JSON.stringify(parsed)}`);
  }
  return {
    foreignPids: parsed.foreignPids.filter((p): p is number => typeof p === "number"),
    ownership: parsed.ownership,
    ownPids: parsed.ownPids.filter((p): p is number => typeof p === "number"),
  };
}

/** 直接问「这句命令行算不算本检出的应用服务」。 */
function isApp(cmdline: string): boolean {
  const script = `
    import { isAppDevServerCmdline } from ${LAUNCHER};
    process.stdout.write(JSON.stringify(isAppDevServerCmdline(${JSON.stringify(cmdline)}, ${JSON.stringify(ROOT)})));
  `;
  const parsed: unknown = decidePort(script);
  return typeof parsed === "boolean" && parsed;
}

describe("端口残留回收：显式端口 + 应用服务自证（ISSUE #621）", () => {
  it("编排器起服务一律显式传端口，缺省解析链不算显式", () => {
    const script = `
      import { usesExplicitPort } from ${ORCH};
      process.stdout.write(JSON.stringify([
        usesExplicitPort(3311), usesExplicitPort(null), usesExplicitPort(NaN), usesExplicitPort(0), usesExplicitPort(-1),
      ]));
    `;
    expect(decidePort(script)).toEqual([true, false, false, false, false]);
  });

  it("显式端口上的本仓库 dev server 判定为「本检出残留」并回收", () => {
    const pids = [3301];
    const cmds = { 3301: `node ${ROOT}/scripts/dev.mjs -p 3311 -H 127.0.0.1` };
    const result = verdictFor(3311, pids, cmds);
    expect(result.ownership).toBe("own");
    expect(result.ownPids).toEqual([3301]);
    expect(result.foreignPids).toEqual([]);
  });

  it("next CLI 层同样算自证（端口上的监听者常常是 next-server 这一层）", () => {
    const cmds = {
      3302: `node ${ROOT}/node_modules/next/dist/bin/next dev --turbo -p 3311 -H 127.0.0.1`,
    };
    const result = verdictFor(3311, [3302], cmds);
    expect(result.ownership).toBe("own");
    expect(result.ownPids).toEqual([3302]);
  });

  it("缺省端口（未显式指定）一律不回收：无法与用户自己起的实例区分", () => {
    const cmds = { 3303: `node ${ROOT}/scripts/dev.mjs -p 3311` };
    const result = verdictFor(null, [3303], cmds);
    expect(result.ownership).toBe("foreign");
    expect(result.ownPids).toEqual([]);
  });

  it("只有检出根路径、跑的不是应用服务的进程照旧不碰（多检出并行保护 §1.4）", () => {
    const cmds = {
      3304: `python ${ROOT}/tools/whatever.py --port 3311`,
      3305: `node ${ROOT}/node_modules/.bin/some-other-cli serve`,
    };
    const result = verdictFor(3311, [3304, 3305], cmds);
    expect(result.ownership).toBe("foreign");
    expect(result.foreignPids).toEqual([3304, 3305]);
    expect(result.ownPids).toEqual([]);
  });

  it("同一端口上混有应用服务与别的进程时，只回收前者", () => {
    const cmds = {
      3306: `node ${ROOT}/scripts/start.mjs -p 3311`,
      3307: `python ${ROOT}/tools/whatever.py`,
    };
    const result = verdictFor(3311, [3306, 3307], cmds);
    expect(result.ownership).toBe("own");
    expect(result.ownPids).toEqual([3306]);
    expect(result.foreignPids).toEqual([3307]);
  });

  it("命令行取不到（权限受限）时保守判「别人的」", () => {
    const result = verdictFor(3311, [3308], {});
    expect(result.ownership).toBe("foreign");
    expect(result.ownPids).toEqual([]);
  });

  it("自证判据只认本仓库的应用服务形状，检出根路径是硬前提", () => {
    expect(isApp(`node ${ROOT}/scripts/dev.mjs -p 3311`)).toBe(true);
    expect(isApp(`node ${ROOT}/scripts/start.mjs -p 3311`)).toBe(true);
    expect(isApp(`node ${ROOT}/node_modules/next/dist/bin/next dev --turbo -p 3311`)).toBe(true);
    // 别的检出的服务：路径不在本检出根内
    expect(isApp("node /somewhere/else/scripts/dev.mjs -p 3311")).toBe(false);
    // 只有检出根路径但跑的是别的东西
    expect(isApp(`python ${ROOT}/tools/whatever.py --port 3311`)).toBe(false);
    // 完全没有检出根路径（用户直接在别处 pnpm dev）
    expect(isApp("node /usr/lib/node_modules/next/dist/bin/next dev")).toBe(false);
    expect(isApp("")).toBe(false);
  });

  it("旧判据仍优先：pidBelongsToRoot 命中时不需要自证（cwd 落在检出内）", () => {
    const script = `
      import { portOwnershipVerdict } from ${ORCH};
      const result = await portOwnershipVerdict({
        requestedPort: null,
        verdict: { ownership: "own", ownPids: [4401], foreignPids: [] },
        cmdlineOf: async () => { throw new Error("旧判据命中时不该再问命令行"); },
        isAppProcess: () => { throw new Error("旧判据命中时不该再自证"); },
      });
      process.stdout.write(JSON.stringify(result));
    `;
    expect(decidePort(script)).toMatchObject({
      ownership: "own",
      ownPids: [4401],
    });
  });
});

describe("waitForPortsFree —— 回收与清缓存/起服务之间的有界同步点（#4333）", () => {
  it("端口族全部空闲 → free=true，且只探一轮", async () => {
    const probe = vi.fn(() => Promise.resolve([]));
    const result = await waitForPortsFree(probe, [3779, 3780], { budgetMs: 300 });
    expect(result.free).toBe(true);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("预算内一直被占 → free=false，并点名被占端口", async () => {
    const probe = vi.fn(() => Promise.resolve([1234]));
    const logs: Array<string> = [];
    const result = await waitForPortsFree(probe, [3779], {
      budgetMs: 300,
      intervalMs: 50,
      log: (m) => logs.push(m),
    });
    expect(result.free).toBe(false);
    expect(result.occupied).toEqual([3779]);
    expect(logs.join("\n")).toContain("3779 仍被占用");
  });

  it("先被占、等待中释放 → free=true（轮询生效）", async () => {
    let calls = 0;
    const probe = vi.fn(() => {
      calls += 1;
      return Promise.resolve(calls >= 3 ? [] : [1234]);
    });
    const result = await waitForPortsFree(probe, [3779], { budgetMs: 2000, intervalMs: 50 });
    expect(result.free).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it("探测不可用 ≠ 空闲：如实 free=false（不许把没量到说成量到空）", async () => {
    const probe = vi.fn(() => Promise.reject(new Error("netstat 不可用")));
    const logs: Array<string> = [];
    const result = await waitForPortsFree(probe, [3779], {
      budgetMs: 300,
      intervalMs: 50,
      log: (m) => logs.push(m),
    });
    expect(result.free).toBe(false);
    expect(logs.join("\n")).toContain("探测不可用");
  });
});

describe("cmdlineBelongsToRoot 的路径边界（#4423）", () => {
  const ROOT_DIR = "G:/ComfyAPP/comfy-app-t3-branch3";
  const OTHER = "G:/ComfyAPP/comfy-app-t3-branch3-old";
  /* 带尾斜杠的形态单列一个常量：模板字面量（no-unnecessary-template-expression）
   * 与字符串拼接（prefer-template）两条清零规则在这里互相夹击。 */
  const ROOT_DIR_TRAILING_SLASH = "G:/ComfyAPP/comfy-app-t3-branch3/";

  it("检出内脚本路径：命中（既有语义不变）", () => {
    expect(cmdlineBelongsToRoot(`node ${ROOT_DIR}/scripts/dev.mjs`, ROOT_DIR)).toBe(true);
    /* 反斜杠归一后命中；大小写不敏感。 */
    expect(
      cmdlineBelongsToRoot("node G:/ComfyAPP/COMFY-APP-T3-BRANCH3/scripts/x.mjs", ROOT_DIR),
    ).toBe(true);
    expect(cmdlineBelongsToRoot(`node ${ROOT_DIR}\\scripts\\dev.mjs`, ROOT_DIR)).toBe(true);
  });

  it("前缀兄弟检出：不命中（裸子串会误判真，PID 复用时误杀整树）", () => {
    expect(cmdlineBelongsToRoot(`node ${OTHER}/scripts/dev.mjs`, ROOT_DIR)).toBe(false);
    /* 同一命令行里两个检出并存：兄弟那段不算数，本检出那段算。 */
    expect(cmdlineBelongsToRoot(`node ${OTHER}/a.mjs --ref ${ROOT_DIR}/b.mjs`, ROOT_DIR)).toBe(
      true,
    );
  });

  it("base 后一位必须是结尾或路径分隔符：目录名恰为前缀的无关文件不命中", () => {
    expect(cmdlineBelongsToRoot(`edit ${ROOT_DIR}-notes.txt`, ROOT_DIR)).toBe(false);
    expect(cmdlineBelongsToRoot(ROOT_DIR_TRAILING_SLASH, ROOT_DIR)).toBe(true);
    expect(cmdlineBelongsToRoot(ROOT_DIR, ROOT_DIR)).toBe(true);
  });

  it("空命令行 / 空根：不命中", () => {
    expect(cmdlineBelongsToRoot("", ROOT_DIR)).toBe(false);
    expect(cmdlineBelongsToRoot("node x.mjs", "")).toBe(false);
  });
});

/**
 * 裸 next dev 的**带引号**命令行（ISSUE #4552）：Windows 的命令行会把脚本路径整个
 * 加引号，node 起 next 的 JS bin 时是 `node "…\bin\next" dev --turbo`——`next` 与
 * `dev` 之间隔了一个收尾引号。此前 `\s+` 前不容许引号，这一最常见形态被卡在
 * `isAppDevServerCmdline` 的正则外：端口被裸 next dev 占着、`pnpm dev` 报
 * EADDRINUSE，`runningAppInstances()` 的归属读数却报「无实例」，两个读数互相矛盾。
 * 既有用例（上方「next CLI 层同样算自证」）拼的是**不带引号**的命令行，所以一直
 * 没盖到这一形态——这里专门补上带引号的真实形状与不该放行的负例。
 */
describe("裸 next dev 的带引号命令行（ISSUE #4552）", () => {
  const sep = path.sep;
  /** 按本机分隔符把「检出根 + 以 / 分隔的尾段」拼成真实路径形态。 */
  const segments = (tail: string): string => `${ROOT}${sep}${tail.split("/").join(sep)}`;
  const nextBin = segments("node_modules/next/dist/bin/next");

  it("node + 带引号的 next bin：命中（裸 next dev 最常见的命令行形态）", () => {
    expect(isApp(`node "${nextBin}" dev --turbo -p 3311`)).toBe(true);
  });

  it("next.cmd 垫片带引号：命中", () => {
    expect(isApp(`"${segments("node_modules/.bin/next.cmd")}" dev -p 3311`)).toBe(true);
  });

  it("pnpm exec 落到 .pnpm 真实路径且带引号：命中", () => {
    const pnpmNext = segments("node_modules/.pnpm/next@16.4.3/node_modules/next/dist/bin/next");
    expect(isApp(`node "${pnpmNext}" dev -p 3311`)).toBe(true);
  });

  it("不带引号的同一命令行照旧命中（修复不回退既有形态）", () => {
    expect(isApp(`node ${nextBin} dev -p 3311`)).toBe(true);
  });

  it("带引号的别的 CLI 不算：引号不能变成放行一切的口子", () => {
    const otherBin = segments("node_modules/.bin/some-other-cli");
    expect(isApp(`node "${otherBin}" serve -p 3311`)).toBe(false);
  });

  it("隔壁检出的 next dev（带引号）不算：归属仍看根路径", () => {
    const segs = ROOT.split(sep);
    segs[segs.length - 1] = "comfy-other-checkout";
    const otherNext = `${segs.join(sep)}${sep}node_modules${sep}next${sep}dist${sep}bin${sep}next`;
    expect(isApp(`node "${otherNext}" dev -p 3311`)).toBe(false);
  });

  it("next devtools 这类 dev 前缀词不误中（dev|start 后仍有词边界守着）", () => {
    expect(isApp(`node "${nextBin}" devtools -p 3311`)).toBe(false);
  });
});
