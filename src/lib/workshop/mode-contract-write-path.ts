// ── 模式契约**写在哪**（唯一出处，纯常量、无 IO）────────────────────────
// 为什么单独一个模块：这个路径有多类读者，而它们**都不能**引对方那一侧 ——
//   · 服务端：`mode-contract.server.ts`（带 `server-only`）据此落盘；
//   · 视图层：保存成功的提示要告诉用户「这份契约是不是在包外、会不会丢」，
//     而 `.server.ts` 引不得（§18.4 的浏览器图边界）。
// 各写一份字符串必然漂移，而漂移的表现就是「界面说的位置不是真的那个」。
//
// 契约有三层，这里的常量说的是**后两层**：
//   · 编译进包的默认值 —— 入库的 `mode-contract-defaults.json`（静态 import 的
//     编译源，纯函数层 `CONFIGURED_MODE_CONTRACTS` 读它），随构建走、到哪都是
//     同一份；**运行期不写它**（ISSUE #4150：运行期写 src 的代价是工作树常挂 M
//     + dev 下 Turbopack 模块图失效、服务端模块内存态随旧实例变孤儿）。改它走
//     代码 / PR。
//   · 本机项目默认覆盖 —— 「保存为项目默认」写出来的那份（整份基线），落
//     `data/`（ISSUE #4150 起，此前直接写 src 那份）。
//   · 本机覆盖 —— 编辑器「保存」写出来的那份（差集），同样落 `data/`。
// 分发产物里没有这些运行期文件（载荷只带生产依赖、编辑器属开发期界面），
// 所以放 `data/` 正合适：它们**本就该**是「这台机器上的状态」，
// 而不是随包分发的项目配置（`config/` 那一层已随 ISSUE #1917 去掉）。

/** 本机覆盖相对**仓库根**（= 运行期的 `process.cwd()`）的路径。 */
export const MODE_CONTRACTS_REL_PATH = "data/workshop-mode-contracts.json";

/** 本机项目默认覆盖（ISSUE #4150）——「保存为项目默认」的运行期写入落这里，
 *  不入库。与 {@link MODE_CONTRACT_DEFAULTS_REL_PATH} 的分工：那份只剩编译期
 *  默认值（静态 import 的编译源，改它走代码 / PR），这份是「这台机器上点过
 *  『保存为项目默认』的那份全量基线」。 */
export const MODE_CONTRACT_PROJECT_DEFAULTS_RUNTIME_REL_PATH =
  "data/workshop-mode-contract-project-defaults.json";

/** 编译进包的默认值落点 —— 静态 import 的编译源（`model-mode-contract.ts` 引它），
 *  **运行期不再写它**。本常量现仅服务存量迁移的判据（旧版把「保存为项目默认」
 *  写在这里，遗留的用户态要搬去
 *  {@link MODE_CONTRACT_PROJECT_DEFAULTS_RUNTIME_REL_PATH}）。 */
export const MODE_CONTRACT_DEFAULTS_REL_PATH = "src/lib/workshop/mode-contract-defaults.json";
