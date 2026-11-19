/**
 * dev-launcher 信号收尾的「单出口」判据（#4409）。
 *
 * 故障形态：常驻 promise 里也注册 SIGINT/SIGTERM 监听把 signal 当「正常退出」
 * resolve 出 `code:0` —— run() 的微任务续体抢在 reapAll（真实异步、挂在宏任务上）
 * 完成之前执行 `process.exit(0)`：POSIX 下 dev/executor-host 成孤儿，Windows 下
 * 退出码变 0、归档与锚点清理被跳过。两层钉：
 *   1. 行为层：`wireSignalShutdown` 的「首信号生效、后续吞掉」（misc-ops.mjs，
 *      `processLike` 注入面，不碰真进程）；
 *   2. 源形态层：dev-launcher 链路不得再出现 promise 内的 signal 监听
 *      （与 `tests/dispatch-startup-points.test.ts` 同族；用 launcherChainSource
 *      而不是单文件 indexOf —— 段落搬走后单文件读法会静默空转）。
 */
import { describe, expect, it, vi } from "vitest";

import { wireSignalShutdown } from "../scripts/launcher-core/misc-ops.mjs";
import { launcherChainSource } from "./helpers/launcher-source";

/** 记录型 process 替身：注册面可断言，信号可手动派发。 */
function makeProcessLike() {
  const handlers = new Map<string, Array<() => void>>();
  const processLike = {
    on: (signal: string, handler: () => void): void => {
      const list = handlers.get(signal) ?? [];
      list.push(handler);
      handlers.set(signal, list);
    },
  };
  const fire = (signal: string): void => {
    for (const handler of handlers.get(signal) ?? []) {
      handler();
    }
  };
  return { processLike, handlers, fire };
}

describe("wireSignalShutdown（信号收尾唯一装配）", () => {
  it("第一个信号触发一次 onSignal，后续信号被守卫吞掉", () => {
    const { processLike, fire } = makeProcessLike();
    const onSignal = vi.fn();
    wireSignalShutdown({ signals: ["SIGINT", "SIGTERM"], onSignal, processLike });

    fire("SIGINT");
    fire("SIGINT");
    fire("SIGTERM");

    expect(onSignal).toHaveBeenCalledTimes(1);
    expect(onSignal).toHaveBeenCalledWith("SIGINT");
  });

  it("SIGTERM 先到就交 SIGTERM，后续 SIGINT 不再触发（谁先到谁收尾）", () => {
    const { processLike, fire } = makeProcessLike();
    const onSignal = vi.fn();
    wireSignalShutdown({ onSignal, processLike });

    fire("SIGTERM");
    fire("SIGINT");

    expect(onSignal).toHaveBeenCalledTimes(1);
    expect(onSignal).toHaveBeenCalledWith("SIGTERM");
  });

  it("三条默认信号都挂上监听：缺一条 = 那条信号没有收尾出口", () => {
    const { processLike, handlers } = makeProcessLike();
    wireSignalShutdown({ onSignal: vi.fn(), processLike });

    expect(handlers.get("SIGINT")).toHaveLength(1);
    expect(handlers.get("SIGTERM")).toHaveLength(1);
    expect(handlers.get("SIGHUP")).toHaveLength(1);
  });
});

describe("dev-launcher 信号单出口（源形态，#4409）", () => {
  const source = launcherChainSource();
  expect(source.trim(), "launcherChainSource 拼出空文 ⇒ 落在它身上的反向断言恒真").not.toHaveLength(
    0,
  );

  it("常驻 promise 不再把 signal 当「正常退出」resolve", () => {
    /* 修缺陷前的形状：`process.once("SIGINT"/"SIGTERM", () => resolve({...}))`。
     * 反向断言针对代码而非注释 —— 用例顶部那份源码没有剥注释，这里按注册语句
     * 的完整形状匹配（resolve 调用在场才算命中），注释里提到 process.once 不误报。 */
    expect(source).not.toMatch(/process\.once\(\s*["']SIG(?:INT|TERM)["'][^)]*resolve/);
  });

  it("模块级收尾走 wireSignalShutdown 装配，退出码映射（130/143）在场", () => {
    expect(source).toContain("miscOpsWireSignalShutdown");
    expect(source).toMatch(/"SIGINT"\s*\?\s*130\s*:\s*143/);
  });
});
