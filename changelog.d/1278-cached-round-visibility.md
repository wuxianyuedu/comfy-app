## Added

- **整轮命中 ComfyUI 执行缓存时，日志里有了按节点的现场与一句总体定性**（ISSUE #1278，P3 §5 ADR §27；签字口径 (a)+(c)）。这种轮次里 comfy-cli 一个 `executing` / `progress` 都不发（实测事件序列：`converted` / `prompt_preview` / `queued` / `execution_cached`×11 / `executed` / `output` / `envelope`），于是那 ~20s 里面板只有「已提交」和收口两行、状态栏「当前节点」空着，而任务其实**已经跑完了** —— 看着像卡住，实际是省下了重算。

  - 每个 `execution_cached` 一行「≡ comfy-cli 节点 [76:69] 采样去噪（KSampler） 命中缓存，跳过」；全轮命中时在收口前再补一句「≡ 本轮 11 个节点全部命中 ComfyUI 执行缓存（未重算，因此没有按节点进度）」。总数取自 `converted.node_count`，不自己数 UI 图。
  - **状态栏那一格在缓存轮仍然空着，这是刻意的**：`progressNode` 的契约（4-B2 定的）是「**当前**节点 + 步数」，而缓存轮没有「当前」——把最后一个被跳过的节点写进去等于显示一个早已跑完的节点。宁缺不假，现场改由上面那 N 行 + 一句汇总承载。
  - `execution_cached` 与 `executing` 一样**自带** `class_type` 与 `title`，所以名字不用回查图；三段里那段 `[id] 中文名（ClassType）` 收成模块内一个 `nodeTag()`（三个动词同一格内容，各写一遍迟早给出不一致的名字）。
  - 混合轮（只打掉一句提示词：`execution_cached`×7 + `executing`×4）实测**不出**汇总行 —— 那一刻缺的是进度而不是定性，写「全部命中」就是假话。顺带记一条复演手法：造「部分命中」要改 `params.workflowInputs` 那条 override，改 `execPayload` 里子图定义的 widgets 无效（提交图是「载荷 + override」现场合成，override 会覆盖图里那格）。
- 判据：`src/lib/comfyui/executor-cli-stream.test.ts` 新增 4 条（缓存行文案与「一次都不调 `onProgress`」/ 同名节点跨动词一致 / 全命中才给汇总且收口照旧 / 混合轮与缺 `converted` 两种情形都沉默）。变异验证：把判据放宽成 `cachedNodes >= 0` 并把文案换成占位串 → 3 条红。文档同步 guide-executor-host.md 里那句「comfy-cli 拿不到类名时为空」的相邻口径（现在写明缓存轮为空是设计而非缺陷）。**未做**：WS 那条路径同样不认这一帧（`protocol-adapter.classify()` 把它落到 `other`），但它在本机构造不出形状、且历史上是「一帧带 `data.nodes[]`」的另一种形态，照 #1202 的教训必须先取证，另开 issue 记账。
