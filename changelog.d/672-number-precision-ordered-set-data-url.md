## Changed

按「同一件事的多种写法」再扫一轮，三条账各收成一处实现，三条判据都是硬闸（P50/P51/P52）：

- **「把一个数字按某档精度写成字符串」→ `~/lib/number-format`**。全库 **26 处
  `toFixed(`**，四派写法都编译、都运行、类型都对，差别只在几个语义决定上：
  小数位从哪来（写死 / props / 量纲巧合）、**末尾的零要不要留**（`1.00` 还是 `1`
  —— 而 ComfyUI 存的就是剥过零的形态，于是同一个值在节点卡片与画布设置里长得不一样）、
  整数要不要也进格式化、大数值要不要绕开。还有一处更隐蔽的
  `(Math.round(v * 100) / 100).toFixed(2)` —— **两层舍入**。出口给四档：
  `fixed`（`toFixed` 唯一落点）/ `trimmed`（剥尾零，负零归一到 `"0"`）/
  `trimFixed`（整数不带小数点）/ `alphaText`（CSS alpha 段固定 3 位不剥零）。
  **非有限数一律 `null`** —— `NaN.toFixed(2)` 是 `"NaN"`，渲染出来是一个假的值。
- **「把一组值去重 / 合并成有序集合」→ `~/lib/ordered-set`**。`[...new Set(xs)]`
  与 `Array.from(new Set(xs))` 混用，而比选型更要紧的是**排序口径也不一**：
  `localeCompare` 让 `"apple" < "Zebra"`、`<` 让 `"Zebra" < "apple"`，两种混用
  会让同一份文件列表在不同面板顺序相反；另有「按字段去重」在各处手写一遍 `for`
  循环（键 `file.absPath` 与值 `LocalWorkflowFile` 是两件事，`new Set(xs)` 表达不了）
  与「两路来源取并集」。出口给 `unique` / `uniqueSorted` / `uniqueBy` / `union` /
  `compareText`：**顺序是显式参数**，`uniqueBy` 的键为 `0` / `false` 时**不跳过**。
- **「拼一个 data: URL / 读回它的载荷」→ `~/lib/media/data-url`**。手拼 3 处，
  读回的一侧 6 处各写一遍「找第一个逗号、后面就是 base64」，而三处读法**互相矛盾**：
  `slice(indexOf(",") + 1)` 在缺逗号时把**整串**当 base64 交给解码器（它跳过非法
  字符）→ **静默解出垃圾字节**；`split(",")` 那一档判了逗号却**写成空串** → 写一个
  0 字节文件冒充产物。另有合法但被无条件忽略的输入：非 base64 的 data URL
  （`data:text/plain,hello` 的载荷是百分号编码，按 base64 解只会得乱码）。出口给
  `isDataUrl` / `isInlineMedia` / `toDataUrl` / `wrapBase64` / `toBase64` /
  `parseDataUrl` / `base64PayloadOf`；**畸形输入给 `null`，不静默解垃圾**。

### Fixed

- **`llm/video-task-util` 的畸形 data URL 不再写一个 0 字节文件冒充产物**。收口前
  `data:image/png;base64`（缺逗号）会落到 `?? ""` → 写盘空文件 → **返回非 null 路径**，
  调用方拿着它当有效本地媒体继续往下走。现在按「落盘失败一律返回 `null`」的既有口径
  处理。既有用例 `data URL 缺逗号时分隔符兜底` 的**名字**写着「不把整个串当 base64 解」，
  钉住的却是这另一种静默失败，已随之改成断言 `null`。
- **`server/workshop/comfyui` 的 `fetchToBuffer` 对畸形 data URL 不再静默解垃圾**：
  同样从「把整串交给 `Buffer.from`」改成显式报错。
- `format-bytes` / `server/film/orchestrator` / `server/workshop/final-compose` /
  `FinalComposer` / `WorkflowCanvasSettings` / `RgthreeBodies` / `materials` 等落点的
  数字精度与排序统一走出口 —— 取值一字未改。
- 顺带清掉 3 行存量英文注释（`mime-ext` / `safe-name` / `check-ui-primitives`），
  让注释语言门禁回到 0/0（它们此前只在 master 上松着，会让下一个提交者看到与自己无关的红）。

判据：`check-ui-primitives.cjs` 新增 P50/P51/P52（硬闸，扫 `src/components` / `src/app`
/ `src/lib` / `src/server`），14 条契约用例。**三条判据都做了反向验证**：用
`git show HEAD:` 逐个文件回放，P50 命中 28 处 / 14 文件、P51 命中 5 处 / 4 文件、
P52 命中 6 处 / 5 文件 —— 且**判据比人工梳理多找到几处**（`localWorkflows` 与
`materials` 的 `localeCompare`）。

三条边界都是踩出来的：P50 不数 `Math.round(` / `padStart(`（那是像素取整与补零的账）；
P51 不数不带比较器的 `.sort()`（按码位排是另一个判据）；P52 **必须**一起数
`split(",")` 那种更差的写法（与 P13 同款：漏掉更差的写法，被拦下的就永远只是合规者），
但要与 `data:` 前缀同现才不会误伤 CSV 解析，且**刻意不数 `startsWith("data:")`**
（SSE 帧前缀也是这个写法，那是流式解析的另一条账）。

新增 `number-format.test.ts`（13 条）/ `ordered-set.test.ts`（13 条）/
`media/data-url.test.ts`（16 条，含浏览器侧无 `Buffer` 时的分块 `btoa` 分支），
三个出口同批登记 `coverage.include` + `thresholds`（均按实测值设满档）。

规范同步 `16 §16.2.3`（判据表 + 硬闸清单三十五件事）+ `§16.2.4.54 ~ §16.2.4.56`
（三条台账）+ `§16.2.4` 台账三行。
