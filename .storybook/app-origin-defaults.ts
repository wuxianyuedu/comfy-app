/**
 * Storybook 注入层要的「应用 origin」—— **入库的缺省值 + 字段名/类型**。
 *
 * ## 为什么要有这个文件（ISSUE #1409）
 *
 * 那个值**必须**是当前检出算出来的：应用端口按检出路径推导（3200~3999），
 * 写死一个值在别人的 checkout 上必然错。所以它由 `scripts/storybook-assets.mjs`
 * 在 `pnpm storybook` 启动时调权威实现 `scripts/app-port.mjs` 现算，
 * 写成一份**不入库**的 `.storybook/generated/app-origin.json`。
 *
 * 病在**谁去读它**：原先注入层直接 `import` 那个生成件（当时是一份生成的 `.ts`），
 * 而 `tsconfig.json` 的 include 显式列着 `.storybook` 那两条通配（点目录不在 glob
 * 的默认展开范围里，不列就是 tsc 与 eslint 的双重盲区 —— 那条动机是对的），
 * 于是**没跑过 `pnpm storybook` 的检出 `tsc --noEmit` 必报 TS2307**。而 tsc 正是
 * 提交门槛的 A 组：报错指向谁都没碰过的文件，拦住的却是从那份基线分出去的
 * **每一次**提交。
 *
 * **`tsconfig.json` 的 `exclude` 治不了这个病（实测）**：exclude 只过滤 include
 * 的 glob，拦不住「作为 import 目标被拉进程序」的文件。最小复现 —— include
 * 那一对 `.storybook` 通配、exclude `.storybook/generated`，入口里照旧 `import`
 * 那个模块，文件缺了照样 TS2307。
 *
 * ## 分工
 *
 * | 角色                | 谁                                              | 入不入库     |
 * | ------------------- | ----------------------------------------------- | ------------ |
 * | 类型 + 缺省值 + 引导 | **本文件**                                      | 入库         |
 * | 本检出的真值        | `.storybook/generated/app-origin.json`          | 不入库，可缺 |
 *
 * 于是 tsc 只需要解析本文件（与 `app-origin-reader.ts`），生成件缺了只是一种
 * **常态**：那份 JSON 由 `preview.tsx` 在配置加载期（Node 里）经 reader 读出来，
 * 读不到就用这里的缺省值。没有「类型程序要解析一个可能不存在的文件」这回事。
 */

/** 解析链端口 + origin + 来源的形状（生成的那份 JSON 与这里逐字段对齐）。 */
export type AppOriginOverride = {
  /** 解析链端口（应用实际监听的端口）。 */
  APP_DEV_PORT: number;
  /** 真 tRPC 链路指向的应用 origin。 */
  APP_DEV_ORIGIN: string;
  /** 上面那个值是怎么来的（`env` / `derived` / `fallback` / `default`）。 */
  APP_DEV_PORT_SOURCE: string;
};

/** 解析链端口兜底值：与 `scripts/app-port.mjs` 的 `FALLBACK_PORT` 同值同语义
 *（"推导不可用时的那一个"）。**刻意不 import 它** —— 那条链路的入口不许挂在
 *  构建期模块图上（`src/lib/core/config.ts` 记着同一条口径）。 */
const FALLBACK_PORT = 3100;

/** 缺省形态：没跑过 `pnpm storybook` 的检出画面上显示的东西。 */
export const APP_ORIGIN_DEFAULTS: AppOriginOverride = {
  APP_DEV_PORT: FALLBACK_PORT,
  APP_DEV_ORIGIN: `http://127.0.0.1:${String(FALLBACK_PORT)}`,
  APP_DEV_PORT_SOURCE: "default",
};

/** 解析链端口（缺省形态）。真正使用时请用 reader 读出来的那份。 */
export const APP_DEV_PORT = APP_ORIGIN_DEFAULTS.APP_DEV_PORT;

/** 真 tRPC 链路指向的应用 origin（缺省形态）。 */
export const APP_DEV_ORIGIN = APP_ORIGIN_DEFAULTS.APP_DEV_ORIGIN;

/** 上面那个值是怎么来的（缺省形态）。 */
export const APP_DEV_PORT_SOURCE = APP_ORIGIN_DEFAULTS.APP_DEV_PORT_SOURCE;

/** 注入层的缺省 origin（`withTrpcApp` 在旋钮没给值时的落点）。 */
export const DEFAULT_APP_ORIGIN = APP_ORIGIN_DEFAULTS.APP_DEV_ORIGIN;
