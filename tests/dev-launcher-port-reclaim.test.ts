/**
 * 端口残留回收判据的回归护栏（ISSUE #621）。
 *
 * 现场：用户在别的项目里用 `COMFYAPP_PORT` 固定过端口，本检出的 `.env` 里也写着
 * 同一个数字；上一次启动的实例（dev server）退出得不干净，端口仍被它听着。
 * 兜底回收路径**一条也没跑**：
 *   - 会话锚点（`run/launcher-session.json`）在正常收尾时已被清掉；
 *   - `pidBelongsToRoot` 按「命令行里有没有出现过检出根路径」判定，而
 *     `pnpm dev -p N`（缺省端口）与 `pnpm exec next dev --turbo` 两条命令行里
 *     **都没有检出根路径** → 判成「别的检出 / 别的程序」，按 §1.4 只提示不回收。
 * 结果是死死卡在端口被占，而那个进程其实就是本检出自己的。
 *
 * 判据现在分两层（唯一出处 `scripts/launcher-core/orchestrator.mjs`）：
 *   1. `usesExplicitPort()` —— 编排器有没有把端口**显式传给** dev server。
 *      `pnpm dev` 一律是 `pnpm dev -p <port>`（Next 不认 `COMFYAPP_PORT`），
 *      因此显式口上的本检出应用服务只可能是残留；
 *   2. `portOwnershipVerdict()` —— 在「显式端口」这个前提下，用**应用服务自证**
 *      （`scripts/dev.mjs` / `scripts/start.mjs` / `next dev|start` +
 *      检出根路径）把「本检出自己的服务」从「别的程序恰好从本检出目录启动」
 *      里分出来。缺任一前提就不动它 —— 宁可放过一次残留，也不猜着杀别人的进程。
 */
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const LAUNCHER = JSON.stringify(join(process.cwd(), "scripts", "dev-launcher.mjs"));
const ORCH = JSON.stringify(join(process.cwd(), "scripts", "launcher-core", "orchestrator.mjs"));
const ROOT = process.cwd();

function join(...parts: string[]): string {
  return parts.join("/");
}

/** 在子进程里调真实实现（判据是纯函数，不 mock、不造进程）。 */
function decidePort(script: string): unknown {
  const out = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    cwd: ROOT,
  });
  if (out.status !== 0) throw new Error(out.stderr || out.stdout);
  return JSON.parse(out.stdout);
}

/** 直接问「显式端口 + 这份进程表会得到什么结论」。 */
function verdictFor(requestedPort: number | null, foreignPids: number[], cmds: Record<number, string>) {
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
  return decidePort(script) as { ownership: string; ownPids: number[]; foreignPids: number[] };
}

/** 直接问「这句命令行算不算本检出的应用服务」。 */
function isApp(cmdline: string): boolean {
  const script = `
    import { isAppDevServerCmdline } from ${LAUNCHER};
    process.stdout.write(JSON.stringify(isAppDevServerCmdline(${JSON.stringify(cmdline)}, ${JSON.stringify(ROOT)})));
  `;
  return decidePort(script) as boolean;
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
    expect(decidePort(script)).toMatchObject({ ownership: "own", ownPids: [4401] });
  });
});
