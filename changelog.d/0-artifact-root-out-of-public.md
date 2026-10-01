## Changed

- **产物根从 `public/generated` 搬到仓库根的 `generated/`**（台账 A13 的结构性关法，
  收掉那条「静态直发旁路」）。`public/**` 由 Next 按静态文件直接发出、不经过任何
  route handler，所以根住在那儿的时候，`/api/generated/[...path]` 上的会话与归属判定
  把 URL 里的 `api/` 去掉就整条绕过（实测过同一份图 200 / 401 两个答案），
  唯一的补法是 `src/proxy.ts` 那条 rewrite —— 而它依赖 `config.matcher` 把每个
  带扩展名的形状列全，漏一个是「一行代码不动、判据零执行、零报错」。
  现在那条通道不存在，判据只剩 route 一处。
  **URL 一个字都没动**：`/api/generated/…` 是写进库里的值（`TaskImage.localPath` /
  `Film.localPath`），磁盘根与它是两件事，所以历史产物照常读得到。
  上一刀（A8 第二段）把七份副本收成唯一出处，正是这一处改能动起来的前提。
- **`src/proxy.ts` 那条 rewrite 留着，但职责降级**为「让老数据里 `/generated/…`
  那种形状仍然走闸」的兼容层；漏配 `matcher` 的表现也随之从「绕过闸门拿到原图」
  变成「这条路 404」—— fail 的方向从泄漏变成读不到。这个变化写进 `proxy.ts`
  与 `proxy.test.ts` 的注释，免得后来人按旧理由理解这一层。
- **三处界面文案不再自己抄落点**：`ProjectOutputs.tsx` 导出 JSON 的 `savePath`、
  `ProjectOutputsMetadataSheet.tsx` 的「文件已保存至 …」、`MaterialLibraryPanel.tsx`
  的「素材保存在 …」原本各写一份 `public/generated/…` 字面量 —— 抄的那一份不会随
  搬迁而红，表现就是界面让人去翻一个已经不存在的目录。
- `scripts/comfyapp-open-folder.ps1` 的允许根跟着改成 `..\generated`
  （它由 `tests/artifact-layout-single-source.test.ts` 的**跨语言成对判据**钉着：
  不改就红，并点名要改哪一行 —— 这一刀里它确实红了）。
- **刻意留下一处没改**：`src-tauri/src/lib.rs:1051` 那段「运行期目录按 `process.cwd()`
  解析」的清单里还写着 `public/generated/`。改注释也会触发 `cargo test`（本机冷 430s）
  与「改了壳必须重编 release」那道时效判据，为一条注释让整笔 PR 背一次完整壳编译不值；
  条件是**下一次任何动到壳的 PR 把它捎上**，理由与那一行的位置都记进了台账 A13。

## Added

- **一次性搬迁历史盘上文件**：`src/lib/media/artifact-root-migration.server.ts`，
  接在 `src/instrumentation.ts` 的 nodejs 分支、排在会读镜头视频的成片恢复之前。
  三条硬约束各有用例（7 条，全在临时目录里跑，不碰仓库）：
  ① 新根已有同名条目 ⇒ **留在原地、绝不覆盖**（这条优先于「搬干净」）；
  ② 条目被占用（Windows EPERM）⇒ **不抛**，但往面板写一条说清「哪个条目、留在哪」的错误
  （硬规则 4：失败路径要有日志 + 用户可见出口）；③ 幂等靠「旧根还在不在」，
  空转时连新根都不创建（首启目录仍由写侧 `mkdir(recursive)` 负责）。
  两个宿主同时起时撞到的 ENOENT 记成「对方已搬走」，不算失败也不写错误。
  反向验证：把「同名就跳过」短路 → 恰好「绝不覆盖」那条红。
  另加一条**接线断言**（读 `instrumentation.ts` 源码）：搬得对但没启动点去调它，
  等于没搬 —— 删掉那一行的表现是「老用户升级后历史产物全 404，而测试与构建全绿」。
- **一层浏览器安全的形状定义** `src/lib/media/output-layout.ts`：目录名、子层名、
  URL 前缀、相对段与给人看的落点（`artifactDirDisplay()`）。它不引 `node:path`
  （所以视图层引得到，`tests/client-bundle-node-builtins.test.ts` 是那道闸），
  `output-paths.ts` 反过来 import 它并原样再导出 —— 保持「调用点只认一处」，
  不让「有两个地方可以抄」重新长回来。
- **顺手关掉一条分发卫生账**：`build-desktop.mjs` 无 filter 整树拷 `public/**`，
  而 `standalone-private-inputs.mjs` / `check-standalone-contents.cjs` 放行 `public`
  的理由写的正是「静态资源与**生成图落地目录**」—— 攒在构建机上的产物会跟着桌包分发。
  新根 `generated` 不在任何一层顶层白名单里，默认拒绝直接把它挡在包外（无需新增条目），
  两处注释同步改成「产物不在这里」。

## 已知窗口（写清，不当缺陷藏起来）

`src/instrumentation.ts` 在 dev 下懒编译（实测 `✓ Ready` 之后约 40s 才跑这一支），
所以升级到本版的开发机，头 40 秒里读历史产物会拿到 404；桌包是进程起来就跑，
用户侧没有这个窗口。要关掉得在 `scripts/dev-launcher.mjs` 的预检里加一步，
而那是「全平台唯一编排」，动它前须完整读 launch-and-build §1–§3 ——
本批没为这 40 秒去碰启动链路（口径与理由记在台账 A13）。
