// ── 模型适配器**项目默认**在哪（唯一出处，纯常量、无 IO）────────────────
// 与 `mode-contract-write-path.ts` 同一手法：这个路径有两类读者，而它们
// **都不能**引对方那一侧 ——
//   · 服务端：`model-adapter-defaults.server.ts`（带 `server-only`）据此读盘；
//   · 视图层：数据落点徽标要告诉用户「这份基线在仓库里的哪个文件」，而
//     `.server.ts` 引不得（§18.4 的浏览器图边界）。
// 各写一份字符串必然漂移，而漂移的表现就是「界面说的位置不是真的那个」。

/** 项目默认（模型适配器）相对**仓库根**（= 运行期的 `process.cwd()`）的路径。
 *
 *  入库、跟代码走（ISSUE #3951）：提交后每个检出与每个桌包都带这份基线。
 *  运行期只读不写（ISSUE #5001）—— 改它走改代码 / 提 PR 那条路；静态 import
 *  它的那一侧见 `model-adapter-defaults.server.ts` —— 编译进产物后读的就是
 *  这份快照。 */
export const MODEL_ADAPTER_DEFAULTS_REL_PATH = "src/lib/workshop/model-adapter-defaults.json";
