/** 平台/宿主判据的 fixture 层（vitest 5 `test.extend`）：平台与宿主形态变成用例的显式入参，「跑不跑」
 * 由所依赖 fixture 在本机是否可满足决定，取代整组 `runIf` 与各文件手抄的 try/finally（台账 E7）。纪律：
 * 不可满足的依赖 `skip` 并说清为什么（假绿灯比 skip 更糟）；能注入的一律注入，切 `process.platform`
 * 是最后手段（`killProcessTreeByImage`/`Sync` 才需要）；收尾走 `await use(...)` 之后，不用 `finally`。 */
import { test as base, expect } from "vitest";

/** 平台维度：这台机器的真平台 + 「切成某个平台跑一段」的能力。 */
export type PlatformFixtures = {
  /**
   * 把 `process.platform` 切成指定值跑一段；返回「恢复」函数但调用点**不要自己调**
   * （`onTestFinished` 已挂）；需临时再切一次用 `platform.becomes(...)` 的返回。
   */
  asPlatform: (value: NodeJS.Platform) => void;
  /** 这台机器是不是 Windows（`realPlatform` 的派生，避免各处重打 `=== "win32"`）。 */
  onWindows: boolean;
  /**
   * 真实平台。**只读**，由宿主决定；判据要的是「这台机器上这条能不能跑」。
   */
  realPlatform: NodeJS.Platform;
};

/** 宿主形态维度：被测代码问「这个命令能不能起」时，谁回答。 */
export type HostFixtures = {
  /**
   * POSIX 语义宿主探针：名单里的路径带执行位且真起得来。必须注入而非真探测 —— Windows 实测
   * `fs.accessSync(X_OK)` 对 0o755/0o644/0o444/0o000 一律通过、无扩展名 `.exe` 改名后 spawn 得
   * `ENOENT`，「没有执行位」与「内核解析 shebang」两档造不出来；注入后两端判同一结论。
   */
  makeHost: (usable: Array<string>) => {
    access: (candidate: string) => void;
    spawn: (cmd: string) => string | null;
  };
};

/**
 * 这台机器是不是 Windows —— 给 `skipIf` / `runIf` 用的字面量。导出常量而非各处裸写
 * `process.platform === "win32"`：`tests/conditional-skip-registry.test.ts` 按**守卫文本**归组计数，
 * 散写会让同一平台依赖在登记表里出现多种写法，改一处判据要跟着改几行登记。
 */
export const ON_WINDOWS = process.platform === "win32";

export const test = base.extend<PlatformFixtures & HostFixtures>({
  /* vitest 的 fixture 第一参必须是解构形态（传 `_fixtures` 运行时
   * FixtureParseError）；本 fixture 不依赖其它 fixture，空解构是 API 约束，
   * no-empty-pattern 在此属误报（台账见 tests/helpers/gate-repo.ts 那处）。
   */
  // oxlint-disable-next-line no-empty-pattern
  realPlatform: async ({}, use) => {
    await use(process.platform);
  },

  onWindows: async ({ realPlatform }, use) => {
    await use(realPlatform === "win32");
  },

  // oxlint-disable-next-line no-empty-pattern -- 同上：vitest fixture 第一参必须解构
  asPlatform: async ({}, use) => {
    /* 一次用例里可能切多次（`withWindows` 的调用点就是「切一段、跑、恢复、再跑」），
     * 所以维护一份「原值」，由本 fixture 自己负责在收尾时回滚到位 —— 用例中途
     * throw 也一样（这正是用它替代手写 try/finally 的那个收益）。 */
    const original = Object.getOwnPropertyDescriptor(process, "platform");
    const restore = () => {
      if (original) {
        Object.defineProperty(process, "platform", original);
      }
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

  // oxlint-disable-next-line no-empty-pattern -- 同上：vitest fixture 第一参必须解构
  makeHost: async ({}, use) => {
    await use((usable: Array<string>) => {
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
