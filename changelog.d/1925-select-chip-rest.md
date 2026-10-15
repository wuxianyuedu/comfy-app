## Changed

- **「一排里选一个」的 chip 收口第三批（ISSUE #1925 余量）**：继前两批修掉历史页状态筛选页签与四处手搓之后，按**形态**（而不是名字）把全库同形的剩余落点又复查了一轮，收口 8 处、并说清 5 类**刻意不换**的形态。
  - 收口（→ `ui/select-chip`）：工坊「生成通道」三处（`workshop/ShotStudio`、`workshop/VideoStudio.parts`、`workshop/CharacterPortraitStudio` —— 前两处是**逐字相同**的两份）、`workshop/LLMContext` 的提供方与模型清单、`app/login/page` 的「登录 / 创建账号」、`studio/logs/TaskLogTimeline` 与 `studio/project-canvas/GlobalStepLogPanel` 的级别筛选。
  - 收口（→ `ui/tabs` 的 `line` 档）：`studio/project-canvas/MaterialLibraryPanel` 的作用域切换 —— 与 `HistoryPanel` 那处**逐字同形**（选中给 `border-b-2`、未选中不给 ⇒ 两枚不同高、切换时基线上下跳）。
  - 就地补那一半接缝：`studio/project-canvas/CanvasPanelToolbar` 的面板开关。它点**已打开**的那一枚是**收起面板**（`onSelect(null)`），语义是开关不是单选，落 `role="radio"` 会说错话 —— 所以不动语义，只把选中档的悬停值显式钉回常态。
  - 三处的坏法都是同一个**看不见的接缝**：`Button` 的 `outline` / `ghost` 变体自带 `hover:bg-muted hover:text-foreground`，而手搓的选中分支只写了「未选中之外」的那一半 ⇒ 划过**已选中**的那一枚时悬停档胜出，「选中」在悬停期间被改写成「未选中」。登录页那处更隐蔽：选中档钉住了底色（`cn()` 摘掉了 `hover:bg-muted`）、**没钉字色**，于是只有字色被翻掉。
  - 判据：新增 6 份用例文件 / 12 条（含 `ShotStudio.test.tsx`、`VideoStudio.test.tsx` 两处读法修正 —— chip 是 `role="radio"` 不是 `role="button"`，改的是读法不是它锁的那件事）。**做了负对照**：把实现 revert 回去，这 12 条全红，证明它们抓的是真东西。
  - 刻意**不新增扫描器**（与前两批同一取舍，见规范 §16.2.4.75）；并把「这一族是开放集合、收口按批做」与「5 类不该换的形态」写进规范 —— 把不该换的也换掉，正是那条取舍要防的「逼人把对的代码改错」。

## Docs

- 规范 §16.2.4.75 的落点登记表新增第三批 6 行，并补两条注：**这一族是开放集合（按批收口、台账跟批更新）**、以及**五类刻意不换的形态**（开关 / 多选 / 快速添加动作排 / 可选卡片列表 / 已在 P77 收口的 `ToggleGroup`）。
