// ── 模型适配器**项目默认**写在哪（唯一出处，纯常量、无 IO）────────────────
// 与 `mode-contract-write-path.ts` 同一手法：这些路径有多类读者，而它们
// **都不能**引对方那一侧 ——
//   · 服务端：`model-adapter-defaults.server.ts`（带 `server-only`）据此落盘；
//   · 视图层：保存成功的提示要告诉用户「写进了哪个文件」，而 `.server.ts`
//     引不得（§18.4 的浏览器图边界）。
// 各写一份字符串必然漂移，而漂移的表现就是「界面说的位置不是真的那个」。
//
// 基线有两层，这里的常量说的是这两层：
//   · 编译进包的默认值 —— 入库的 `model-adapter-defaults.json`（静态 import
//     的编译源，`model-adapter-defaults.server.ts` 的 `bundled` 读它），随构建
//     走、到哪都是同一份；**运行期不写它**（ISSUE #4171：运行期写 src 的代价
//     是工作树常挂 M + dev 下 Turbopack 模块图失效、服务端模块内存态随旧实例
//     变孤儿，与 #4150 修掉的侧栏页签 / 模式契约 / 尺寸配置表同族）。改它走
//     代码 / PR。
//   · 本机项目默认覆盖 —— 「保存为项目默认」写出来的那份（整份基线），落
//     `data/`（ISSUE #4171 起，此前直接写 src 那份编译源）。

/** 本机项目默认覆盖（ISSUE #4171）——「保存为项目默认」的运行期写入落这里，
 *  不入库。与 {@link MODEL_ADAPTER_DEFAULTS_REL_PATH} 的分工：那份只剩编译期
 *  默认值（静态 import 的编译源，改它走代码 / PR），这份是「这台机器上点过
 *  『保存为项目默认』的那份全量基线」。 */
export const MODEL_ADAPTER_PROJECT_DEFAULTS_RUNTIME_REL_PATH =
  "data/workshop-model-adapter-project-defaults.json";

/** 编译进包的默认值落点 —— 静态 import 的编译源（`model-adapter-defaults.server.ts`
 *  引它），**运行期不再写它**。本常量现仅服务存量迁移的判据（旧版把「保存为
 *  项目默认」写在这里，遗留的用户态要搬去
 *  {@link MODEL_ADAPTER_PROJECT_DEFAULTS_RUNTIME_REL_PATH}）。 */
export const MODEL_ADAPTER_DEFAULTS_REL_PATH = "src/lib/workshop/model-adapter-defaults.json";
