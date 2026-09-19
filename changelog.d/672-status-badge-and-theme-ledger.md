## Changed

- **状态徽标 / 状态圆点的配色从此只有一处**（`ui/status-badge` + `ui/status-dot`）：此前**七个文件**各写一份「状态 → 配色」表 —— 任务历史 `STATUS_STYLE`、执行日志两份 `statusClass`、项目产出 `STATUS_CHIP`、画布节点 `CanvasNodePrimitives.StatusBadge`、自定义节点设置两份、工坊三处 `StatusBadge` / `ClipBadge`。同一个「已完成」在不同界面是 `bg-emerald-500/15` / `bg-emerald-400/10` / `bg-emerald-100` 三种深浅，改一次状态色要点七遍名。

  收口后的分工：**`ui/status-badge.tsx` 只负责「状态 → 配色」**，`dot` 形态供独立徽标、`dot={false}` 供叠在媒体上的角标；**文案留在调用处**（同一个状态在不同界面叫法不同：任务历史「已完成」/ 画布节点「运行后生成」/ 镜头「片段就绪」，那是业务文案）。画布小写词到大写状态键的映射收进 `lib/project-canvas/canvas-types.ts` 的 `STATUS_BADGE_KEY`，与 `STATUS_LABEL` 并排。

  顺带把工坊三份**逐字相同**的镜头状态表合成一处（`SHOT_STATUS_LABEL` + `ShotStatusBadge`），并把 `WorkflowLibraryList` 的「未载入」色点、`LibraryHostCard` 的「本机」色点接到 `StatusDot`。

- **余量主题色 115 处 → 逐条定性完毕，棘轮基线归零**（`scripts/.theme-color-baseline.json` 现为 `total: 0`）。规范 §3.6.1 的口径是「存量必须逐条定性，登记进 `EXEMPT_TABLES`（带理由）或就地 token 化」——**放进存量里等于两者都不是**。115 处的去向：

  - **就地 token 化 18 处**：新增 `--color-edge-flow-1..4`（画布连线四档渐变，项目画布与工作流编辑器共用）与 `--color-edge-focus-halo`，替掉 `ProjectCanvas` 的四处内联 `stopColor` 与 `ProjectEdge` 的第五份 rgba；`CustomNodesSettings` 的两份状态底色/文字色表改走语义类名。
  - **修掉一条从来就没生效过的写法**：`HomePage` 的项目类别底色写的是 `bg-[${cfg.color}/15]` —— Tailwind 的 JIT 扫不到运行时模板，那条 class 一直是死的（图标方块没有底色）。改 `color-mix(in srgb, …)` 现取。
  - **登记进类型色例外 97 处**：画布连线 / 端口 / 节点模式 / 角色 / 类别色常量表，含 `workflow-node-palette` 的三个**两态外观表**与 `RgthreeBodies` 的 3D 光照参数（判据仍是「这行色值画的是什么」：画的是内容本体，不是承载它的表面）。
  - **登记进固定暗色清单 2 处**：`ui/water-fill-progress` 的水幕 —— 浮在预览图/视频之上的极小面积叠层，且刻意保留 ~0.9 让底层内容隐约可见，判据 1、2 同时成立。

## Added

- **`ui/status-badge.tsx` 的 `dot` 形态**（缺省带状态圆点、`dot={false}` 供叠在媒体上的角标）与 4 个新状态键（`DONE` / `STARTING` / `STALE` / `LOCKED`）—— 都是调用处**实测**用到的，不为凑齐语义而补。

- **两条新的机器判据**：

  1. `src/components/ui/status-badge.test.tsx`（16 条）：常见状态键都有配色且**互不相同**、配色不落 Tailwind 原生调色板字面量、大小写不敏感、未知状态回退中性档、`dot` 形态可关、`label` 覆盖文案但配色仍随状态。
  2. `tests/check-theme-colors.test.ts` 新增「豁免台账」两条：**每条豁免必须带说清「为什么这行色值是内容自己的颜色」的理由**（不能一句「类型色」了事），且专项收口后基线为 0。

  > 为什么零基线还不够：棘轮为 0 之后，把一处**真漏改**顺手登记进 `EXEMPT_TABLES` 是唯一能让数字变漂亮又不改代码的动作 —— 豁免不计入基线，登记完就再也不会出现在报告里。
  2. `tests/ui-primitives-coverage.test.ts` 的清单里加上 `status-badge` / `status-dot`：这两个基元此前**从来没被 `ui/` 外部引用过**。

## Docs

- `docs/standards/16` **新增 §16.2.4.5**（状态色收口 + 逐条定性的去向表 + 「零基线防不住什么」）、§16.2.3 台账补两行（状态圆点 / 状态胶囊 / 余量主题色），§16.2.4.4 ③ 改为「本批定性完毕，见 §16.2.4.5」。
- `docs/standards/03` §3.6.1 补三条口径：定性完毕的标志是基线归零、两态外观常量表按类型色判、**运行时模板 class 不算豁免**（JIT 扫不到等于没写）；§3.6.2 补「状态徽标只有一处配色」。
- `src/app/globals.css`：新增连线渐变四档 token 并进 `@theme`；固定暗色清单补「水幕」一条。
