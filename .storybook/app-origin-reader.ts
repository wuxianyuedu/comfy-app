/**
 * 读**本检出的解析链端口**，供 `preview.tsx` 交给注入层。
 *
 * ## 为什么要绕这一下（ISSUE #1409）
 *
 * 那个值由 `scripts/storybook-assets.mjs` 在 `pnpm storybook` 启动时调权威实现
 * `scripts/app-port.mjs` 现算，落 `.storybook/generated/app-origin.json` ——
 * **不入库**（端口按检出路径推导，3200~3999，不同 checkout 不同，写死必然错）。
 *
 * 原先注入层直接 `import` 那个生成件（当时是一份生成的 `.ts`），于是「类型程序会去
 * 解析一个只有跑过工作台才存在的 gitignored 文件」：`tsconfig.json` 的 include
 * 显式列着 `.storybook` 那两条通配，没跑过 `pnpm storybook` 的检出 `tsc --noEmit`
 * 就必报 TS2307 —— 而 tsc 正是提交门槛的 A 组，拦的是从那份基线分出去的每一次
 * 提交。**`exclude` 治不了**：它只过滤 include 的 glob，拦不住「作为 import 目标
 * 被拉进程序」的文件（最小复现见 `tests/storybook-tsc-input.test.ts`）。
 *
 * ## 两条通道，各管一头
 *
 * | 环节                       | 谁                          | 怎么把值带过去                                    |
 * | -------------------------- | --------------------------- | ------------------------------------------------- |
 * | 读生成件（**Node** 侧）    | `.storybook/main.ts` 的 env | `SB_APP_DEV_PORT` / `SB_APP_DEV_ORIGIN` / `SB_APP_DEV_PORT_SOURCE` |
 * | 取值（**浏览器** bundle）  | 本模块                      | `process.env`（Storybook 的 env 是**编译期内联**） |
 *
 * 为什么不在 `preview.tsx` 里直接读文件：preview 会被**打进浏览器 bundle**，
 * webpack 把 `node:fs` 换成 stub（实测编出来的调用是 `node_fs_ignored_default()`），
 * `readFileSync` 必然抛、永远走兜底 —— 那种「看起来在读、其实读不到」比没有更坏。
 * `main.ts` 不进浏览器 bundle，读文件是它的正常用法；`env` 由 Storybook 在编译期
 * 内联进 bundle（实测 bundle 里是字面量 `"3311"` 而不是 `process.env` 查找）。
 *
 * 类型与字段名由入库的 `app-origin-defaults.ts` 承担，所以本模块与 tsc 都不依赖
 * 那份生成件：它缺了只是一种**常态**（没跑过工作台的新检出）。
 */
import {
  APP_ORIGIN_DEFAULTS,
  type AppOriginOverride,
} from "./app-origin-defaults";

/** `main.ts` 注入的三个键（一处定义，两侧共用）。 */
export const APP_ORIGIN_ENV_KEYS = {
  APP_DEV_PORT: "SB_APP_DEV_PORT",
  APP_DEV_ORIGIN: "SB_APP_DEV_ORIGIN",
  APP_DEV_PORT_SOURCE: "SB_APP_DEV_PORT_SOURCE",
} as const;

/** 形状守卫：字段名/类型与 `AppOriginOverride` 对不上就当没读到，退回缺省。 */
export function parseOverride(value: {
  APP_DEV_PORT: unknown;
  APP_DEV_ORIGIN: unknown;
  APP_DEV_PORT_SOURCE: unknown;
}): AppOriginOverride | null {
  const port = Number(value.APP_DEV_PORT);
  if (
    !Number.isInteger(port) ||
    typeof value.APP_DEV_ORIGIN !== "string" ||
    value.APP_DEV_ORIGIN.trim() === "" ||
    typeof value.APP_DEV_PORT_SOURCE !== "string"
  ) {
    return null;
  }
  return {
    APP_DEV_PORT: port,
    APP_DEV_ORIGIN: value.APP_DEV_ORIGIN,
    APP_DEV_PORT_SOURCE: value.APP_DEV_PORT_SOURCE,
  };
}

/** 本检出的值；`main.ts` 没注入（= 没跑过 `pnpm storybook`）时走入库的缺省值。 */
export function readAppOrigin(): AppOriginOverride {
  return (
    parseOverride({
      APP_DEV_PORT: process.env[APP_ORIGIN_ENV_KEYS.APP_DEV_PORT],
      APP_DEV_ORIGIN: process.env[APP_ORIGIN_ENV_KEYS.APP_DEV_ORIGIN],
      APP_DEV_PORT_SOURCE: process.env[APP_ORIGIN_ENV_KEYS.APP_DEV_PORT_SOURCE],
    }) ?? APP_ORIGIN_DEFAULTS
  );
}
