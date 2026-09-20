## Changed

按「同一件事的多种写法」再扫一轮，三条账各收成一处实现，三条判据都是硬闸（P56/P57/P58）：

- **「把一段路径拼成可展示的一行」→ `~/lib/path-display`**。全库 **18 个文件**
  在做这件事，而它们对三件事各判各的：**相对谁**（`path.relative(LOG_ROOT, …)` /
  `(PROJECT_ROOT, …)` / `(REPO_ROOT, …)` / 干脆原样绝对路径）、**分隔符**
  （`.replace(/\\/g, "/")` 8 处 / `.split(path.sep).join("/")` 2 处 / 不归一）、
  **超长怎么办**（视图侧清一色 `truncate` —— CSS `text-overflow: ellipsis`
  **只留头部**，而路径的语义在尾部：用户看到 `F:\AI\…\src\components\studio\workflo…`
  时，被切掉的恰好是他要看的那一段）。出口给 `toDisplayPath`（相对化 + 归一，
  相对不上就原样返回、不做 `..` 推导）/ `stripPathPrefix`（剥命名前缀，与
  「剥根目录」不是一回事）/ `lastSegments`（取末 N 段 —— 按「段」切而不是按
  字符切，段才是不会被切一半的语义单位）/ `ellipsisMiddle`（中段省略：保头
  也保尾，与 `~/lib/text-clamp` 的 `clampText` 分工是「保两头 vs 保一头」）/
  `normalizeSlashes`。
- **「剔掉私有 prop 再透传」→ `~/lib/dom-props`**。4 个基元各写一份剔除表，
  而**类型侧 `Omit<…, "a" | "b">` 与运行时侧的解构是两份**，必须逐字一致却
  没有任何机器判据：表里有、解构里漏 → 该字段**静默透传给 DOM**（React 19
  只给一条 console 警告，构建与测试都不拦），`value` / `onChange` 这类漏掉的
  表现是「双份受控」—— 界面有值但状态没变。出口让表**只写一遍**：类型侧经
  `OmitOwnProps` 拿 `as const` 的键表算、运行时侧经 `splitDomProps` 拿同一个
  数组剥，结构上不可能漂移。`commonOwnProps` 对「同时扩展 img + video」那类
  取**交集**（写成并集会把只属于一侧的字段也剔掉，那个底层拿不到它该有的属性
  且不报错）；`splitDomProps` **只搬不改写**（不给默认值、不合并 `className`）。
- **「给一个异步结果加超时」→ `~/lib/with-timeout`**。`Promise.race` +
  `setTimeout` 的样板散在 **8 处**，对三件事各判各的：**定时器谁来清**
  （`.finally(clearTimeout)` / 两个分支各清一次 / 三个分支各清一次 / 只有
  `exit` 分支清 —— 漏一处就是悬挂的定时器把子进程引用留到超时）、**超时之后
  干什么**（`reject` / `resolve` 一个哨兵值 / 杀子进程再 fail）、**时长与文案**
  （三处自己算 `${ms / 1000}s`、三处硬编码）。出口给 `withTimeout`（超时抛
  `TimeoutError`）与 `withTimeoutResult`（超时给兜底值），两者共用一条
  「胜出即清定时器」的收尾；`onTimeout` 是显式钩子（杀子进程 / 退订），
  且**钩子抛错不顶替超时结论**。`sleep` 一并收进来（它不是这条账，但同属
  定时器一族）。

### Fixed

- **超长路径的展示不再把「是哪个文件 / 哪个包」切掉**：`WorkflowEditorTopbar`
  的本地文件路径、`DebugChainFooter` 的源码路径、`NodesTab` / `SettingsParts`
  的包目录都从「CSS `truncate` 只留头部」改成显式取**末几段**（完整路径仍在
  `title` 上）。此前这些落点显示出来的正是用户不需要的那一截。
- **`SettingsParts` 的进度行**过去手写 `split(/[\\/]/).slice(-2).join("/")`
  （保留末 2 段、不含省略标记），现走 `lastSegments(…, 2)` 统一口径。
- 四处「取末段当文件名 / 扩展名」的手写（`comfyui/runner-state` 的堆栈帧、
  `llm/video-task-util` 的落盘名、`media/materials` 的基名、
  `project-canvas/canvas-helpers` 的结果名）统一走 `lastSegments`。

判据：`check-ui-primitives.cjs` 新增 P56/P57/P58（硬闸，一上来就不进基线），
22 条契约用例。**三条判据都做了反向验证**：用 `git archive HEAD` 逐个文件回放，
P56 命中 **28 处 / 18 文件**、P57 命中 **5 处 / 4 文件**、P58 命中 **8 处 / 7 文件**。
三条边界都是踩出来的：P56 不数 `path.relative` 的**包含判据**（`startsWith("..")`
/ `isAbsolute` 是「在不在 root 里」，不是展示）、不数 `path.basename`；
P57 只认 Omit 的基类型是**底层元素属性集**的那些（`Omit<LogEntry, "id">` 是数据
模型，不算）；P58 **必须** `setTimeout` 与 race/结算同现（单看 `Promise.race`
会把 `comfyui/status` 的「两路来源抢跑」误判，单看 `setTimeout` 会把看门狗 /
防抖误判）。

新增 `path-display.test.ts`（25 条）/ `dom-props.test.ts`（11 条）/
`with-timeout.test.ts`（15 条），三个出口同批登记 `coverage.include` +
`thresholds`（按实测值设满档，均 100%）与 `check-file-structure.cjs` 的
`DOMAIN_EXEMPT`（三者都是「唯一持有者 + 任何域消费」的顶层单例）。

规范同步 `16 §16.2.3`（判据表 + 硬闸清单四十一件事）+ `§16.2.4.60 ~ §16.2.4.62`
（三条台账）+ `§16.2.4` 台账三行。
