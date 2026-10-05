/**
 * 平台 / 宿主判据的 fixture 层（vitest 5 的 `test.extend`）。
 *
 * 为什么需要它：本仓库有三条「平台分叉」用例线 —— `kill-process-tree` 的
 * POSIX 与 Windows 两组、`executable-resolve` 的宿主形态表。它们的**共同形状**是
 * 「判决面在源码里，而被判的机制由宿主提供」，而宿主的两个维度（平台、shell 形态）
 * 一直靠两件手工活表达：
 *
 *   1. **整组 `describe.runIf(!isWindowsPlatform())`** —— 在 Windows 开发机上那 8 条
 *      一条都不跑（台账 E7 记的形状）。而其中相当一部分判的其实是**决策**
 *      （该不该发组信号、读不到 PGID 时保守到哪一侧），根本不需要真起进程；
 *   2. **各处手写 `Object.defineProperty(process, "platform", …)` 的 try/finally**
 *      （`kill-process-tree.windows.test.ts` 的 `withWindows()`）—— 每个文件各抄一份，
 *      且它是**过程式**的：用例中途 throw 时收尾靠 `finally` 的正确性，
 *      新写一条用例忘了包就静默不切平台。
 *
 * fixture 修的是这两件事：**平台与宿主形态变成用例的显式入参**，
 * 「这条跑不跑」不再是 describe 级的一刀切，而是「它依赖哪个 fixture、那个 fixture
 * 在这台机器上满不满足」。
 *
 * 三条纪律（动手前先读，改这里要同批改它们）：
 *
 *   · **不可满足的依赖要 `skip` 并说清为什么**，不许「为它本来就不可能红而绿」——
 *     后者比 skip 更糟（假绿灯）。这是 `it.skipIf` 的既有口径，fixture 只把它
 *     从「散在用例里的裸 `process.platform`」收到一处。
 *   · **能注入的一律注入，不切平台**。切 `process.platform` 是**最后手段**：
 *     它改的是全局状态，只在被测代码自己读 `process.platform` 且没有注入参数时
 *     才需要（`kill-process-tree` 的 `killProcessTreeByImage` / `killProcessTreeSync`
 *     正是这种 —— `killProcessTreeWith` 有注入参数，那几条就不用切）。
 *   · **fixture 的收尾走 `await use(...)` 之后那一段**，不要用 `finally` 自己管 ——
 *     那正是 `test.extend` 相对手写 try/finally 的收益：用例 throw 时 vitest
 *     保证收尾仍然跑。
 */
import { test as base, expect } from "vitest";

/** 平台维度：这台机器的真平台 + 「切成某个平台跑一段」的能力。 */
export interface PlatformFixtures {
  /**
   * 真实平台。**只读**，由宿主决定；判据要的是「这台机器上这条能不能跑」。
   */
  realPlatform: NodeJS.Platform;
  /**
   * 把 `process.platform` 切成指定值跑一段。
   *
   * 返回值是「恢复」函数，但调用点**不要自己调** —— `onTestFinished` 已经挂了。
   * 需要临时再切一次用 `platform.becomes(...)` 的返回。
   */
  asPlatform: (value: NodeJS.Platform) => void;
  /** 这台机器是不是 Windows（`realPlatform` 的派生，避免各处重打 `=== "win32"`）。 */
  onWindows: boolean;
}

/** 宿主形态维度：被测代码问「这个命令能不能起」时，谁回答。 */
export interface HostFixtures {
  /**
   * POSIX 语义的宿主探针：名单里的路径带执行位且真起得来。
   *
   * 为什么必须注入而不是照旧真探测（Windows 开发机实测）：
   *   · `fs.accessSync(X_OK)` 对 0o755 / 0o644 / 0o444 / 0o000 **一律通过**；
   *   · 把真 `.exe` 改名成无扩展名再 spawn 得到 `ENOENT`。
   * 于是「没有执行位」与「内核解析 shebang」这两档在 Windows 上造不出来 ——
   * 注入之后这张表在两端机器上判同一个结论。
   */
  makeHost: (usable: string[]) => {
    access: (candidate: string) => void;
    spawn: (cmd: string) => string | null;
  };
}

/**
 * 这台机器是不是 Windows —— **给 `skipIf` / `runIf` 用的字面量**。
 *
 * 为什么导出一个常量而不是让各处自己写 `process.platform === "win32"`：
 * `tests/conditional-skip-registry.test.ts` 按**守卫文本**给条件 skip 站点归组计数
 * （登记表要「站点与数量都对得上」）。散在各处的裸表达式意味着同一个平台依赖会以
 * 几种写法出现在登记表里，改一处判据要跟着改几行登记 —— 那正是登记表烂掉的方式。
 * 收敛到一个共享常量之后，档位与理由都在登记表里指得到同一条。
 */
export const ON_WINDOWS = process.platform === "win32";

export const test = base.extend<PlatformFixtures & HostFixtures>({
  realPlatform: async ({}, use) => {
    await use(process.platform);
  },

  onWindows: async ({ realPlatform }, use) => {
    await use(realPlatform === "win32");
  },

  asPlatform: async ({}, use) => {
    /* 一次用例里可能切多次（`withWindows` 的调用点就是「切一段、跑、恢复、再跑」），
     * 所以维护一份「原值」，由本 fixture 自己负责在收尾时回滚到位 —— 用例中途
     * throw 也一样（这正是用它替代手写 try/finally 的那个收益）。 */
    const original = Object.getOwnPropertyDescriptor(process, "platform");
    const restore = () => {
      if (original) Object.defineProperty(process, "platform", original);
    };
    const becomes = (value: NodeJS.Platform) => {
      Object.defineProperty(process, "platform", {
        value,
        configurable: true,
        writable: true,
      });
    };
    await use(becomes);
    restore();
  },

  makeHost: async ({}, use) => {
    await use((usable: string[]) => {
      const set = new Set(usable);
      return {
        access: (candidate: string) => {
          if (!set.has(candidate)) {
            throw new Error("EACCES: permission denied");
          }
        },
        spawn: () => null,
      };
    });
  },
});

export { expect };
