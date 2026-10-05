## Added

- **Storybook 三层注入的场景各自铺厚**（ISSUE #1381 续，规范 16 §16.2.3.11）：注入层的形状不动，只把每一层真正的**维度**摆满，让「真机上会出现的那几档」都有得看。
  - **store 层**（`.storybook/store-sources.tsx`）4 档 → 8 档：新增 `sameMillisecond`（同一毫秒十几行 —— 排序要看 `(time, seq)` 次键）、`singleOrigin`（只一路来源 —— 二维计数表塌缩成一维）、`longTimeline`（2600 条 —— 一页 `LOG_PAGE_SIZE`=2000 之外还有货）、`cliExpandable`（一批可展开的 comfy-cli 原文 —— 展开集合是多选）。
  - **React Flow 层**（`.storybook/flow-canvas.tsx`）3 档 → 6 档：新增 `fanOut`（一个源节点扇出三条线 —— 多端点几何与路径分叉）、`mixedKinds`（八种业务节点混排 —— 端点类型色的分辨率）、`dense`（36 张节点铺满 —— 标尺步长在满负载下现算）。
  - **整屏层**（`.storybook/screen-frame.tsx`）2 档 → 4 档：`ProjectScene` 加可选 `nodes` / `edges`，新增 `longNameProject`（名字长到要截断）与 `filledProject`（**有内容**的项目：四张真节点 + 三条连线）。
  - **量大的场景用生成器，但生成的是「原文」不是「条目」**：`appLines()` / `sameMsLines()` 交出文本（`join("\n")` 交给 `text` 字段），解析 / 分桶 / 计数 / 裁剪照旧全由 `parseFileLogs()` 与 `LOG_STORE_MAX` 等生产代码算。时刻真的递增（长线）或真的全等（同毫秒，步长 0）—— 手写时最容易把「同一毫秒」写成「相邻毫秒」，那样次键就白摆了。
  - **`filledProject` 的节点走 `placeCanvasNode()`**（全库建节点的唯一出口，§16.2.4.38）+ `defaultData(kind)`：手写节点对象只填两个字段，而节点渲染器读的是整套默认值（少一项画布上就是另一种形态）。
  - 五个 store 消费方、两个画布消费方、四个整屏消费方各接上 1~3 份新场景 story。
  - 契约用例 `tests/storybook-injection-layers.test.ts` 7 条 → **9 条**（新增：量大的场景用生成器产原文；有内容的项目走 `placeCanvasNode` + `defaultData`）。
  - 验证：本批 53 条相关 story 全部在无头 Chromium 里打开核对 —— **全部渲染、0 白板**；关键几张（`filledProject` 四节点+连线、`mixedKinds` 八节点类型色、`dense` 36 节点与标尺刻度、`longTimeline` 2600 条与分页摘要、`sameMillisecond` 14 行同刻）逐张看过截图。
