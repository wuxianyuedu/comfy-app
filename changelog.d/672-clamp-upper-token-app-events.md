## Changed

- 按形态又扫一轮，清出三件事的跨文件重复实现，各收成一处（ISSUE #672，规范 16
  §16.2.4.63 ~ §16.2.4.65），三条新判据 **P59 / P60 / P61** 一上来就是硬闸：
  - **「把一个数夹进一个区间」**（全库 27 处 → 0）：新增 `~/lib/clamp` 的
    `clamp` / `clampInt`。收口前四派写法都编译、都运行、类型都对，差别只在
    **参数顺序**（`Math.min(max, Math.max(min, x))` 与 `Math.max(min, Math.min(max, x))`
    都有人写 —— 它在类型上不可分辨，传反了不报错）、**取整在内层还是外层**
    （先取整再夹会在 `[0, 0.4]` 里给出 `0.4`，一个「不是整数的整数值」）、
    **非有限数怎么办**（`Math.max(0, NaN)` 是 `NaN`，会一路静默传播到
    `style` / 落库）。出口把被夹的值放第一位、`NaN` 与 `±Infinity` 分两种处理。
    `~/lib/progress` 的 `clampPct` 改用本出口实现。
  - **「把一个外来串归一成大写记号」**（全库 30 处 → 0）：新增
    `~/lib/upper-token` 的 `upperToken` / `upperTokenOr`。收口前
    `(x ?? "").trim().toUpperCase()` 这一族**不是同一件事** —— 「要不要吃空白」
    这一条直接决定匹配成败（ComfyUI 类型字段带尾随空白、模式码来自用户输入）。
    实况是**同一个文件里两种写法并存**：`model-mode-contract` 的
    `builtInModeContract` trim、同文件的 `modeContractEntries` 不 trim ——
    同一个模式码，经过前者匹配得上、经过后者匹配不上。出口只有一个口径：吃空白。
  - **「跨组件广播一条应用事件」**（全库 11 处裸写 → 0）：新增
    `~/lib/app-events` 的 `AppEvents` 表（事件名与载荷**同处定义**）+
    `emitAppEvent` / `subscribeAppEvent`。收口前 5 条事件散在 6 个文件里，
    失效模式**全是静默的**：`canvas-store-changed` 的名字定义在
    `lib/project-canvas` 却不导出（视图侧 3 处硬编码字符串）、`canvas:produce`
    的载荷形状只在订阅侧有个 `as {...}` 断言、实测有**两条死监听**
    （`open-task` 的派发方早已搬走、`local-workflows-path-changed` 全库只有
    监听侧）—— 没有任何构建、测试会报它们。

## Fixed

- `comfy/comfy-readiness-client` 的轮询间隔此前写成
  `Math.min(opts.pollMs ?? POLL_MS, Math.max(timeoutMs, 1))`：看着像夹取，
  **实则漏了下限** —— `opts.pollMs` 传 `0` 或负数时会真给 `0`，轮询变成
  **不等待的死循环**（ISSUE #672）。改用 `clamp(…, 1, timeoutMs)` 后才是它
  本来想表达的「夹在 `[1, timeoutMs]`」。

## Added

- `scripts/check-ui-primitives.cjs` 新增三条硬闸判据 **P59**（数值夹取）/
  **P60**（大写归一）/ **P61**（应用事件），并补齐出口契约用例与判据契约用例
  （ISSUE #672）。三条判据用 `git archive HEAD` 逐个文件回放做了反向验证，
  收口前分别命中 **27 处 / 24 文件**、**30 处 / 16 文件**、**11 处 / 6 文件** ——
  都比人工按名字梳理找到的多。`src/config` 因此进了扫描根
  （`custom-nodes:updated` 的派发侧住在那里，只扫前四条根会让这条事件的一半
  落在扫描面之外）。
