## Changed

- **`src/components/workshop/**` 域 P71 清零**（31 → 0，接 #955 / #959 / #961 /
  #963 的语义 token 收敛）：13 个文件里的 31 处 `dark:palette` 手写档全部走
  语义 token。所有色映射与前几批同源——error→`destructive`、warn→
  `warning-strong`、success→`success-strong`、info→`info-strong`。
  - **`api-channel-settings-config.ts`**（2 处）：`API_CHANNEL_MSG_STYLE`
    ok/err 表 emerald/red → success/destructive（配置源单一、视图取用一处）。
  - **`AgentOverlay.tsx` / `CharacterDesigner.tsx` / `ScriptGenerator.tsx` /
    `ExtractToolbar.tsx` / `StoryboardPlanner.tsx`**（6 处）：错误提示条 /
    错误面板 red → destructive。
  - **`CharacterPortraitStudio.tsx`**（5 处）：远端 API 未配置的 amber 提示
    → `text-warning-strong`；「生成过程」与「历史日志」两处 `entry.level/kind
=== "error" | "success"` 分色（red / emerald）→ destructive / success-strong
    （与 log 徽标同源）。
  - **`ExtractModelSelect.tsx`**（2 处）：模型可用性提示 ok/err →
    success-strong / destructive。
  - **`ExtractToolbar.tsx` 里 `logBadge(kind)` 表**（4 处）：整块状态色表
    重写——`init → primary`（品牌）、`request → info`（信息/进行中）、
    `output/result → success`（有产物）、`skipped → warning`（待办）、
    `error → destructive`（失败）；indigo→info 是**语义选择**（request
    与 raw-cli 的"原始流"同一族），doc comment 记录映射意图。
  - **`FinalComposer.tsx`**（2 处）：「片段全部完成」pill、「合成清单已导出」
    面板 emerald → success；`bg-amber/15 text-amber`（workshop 待完成琥珀
    accent）**不动**——它已是 workshop 域自有的**待处理**装饰语义、且没有
    `dark:` 手写档，与本批的**状态色**是两回事。
  - **`LLMContext.tsx`**（3 处）：暂无候选模型提示（amber）+ ok/err 消息
    面板 → warning / success / destructive。
  - **`mode-contract/dialog/ModeContractEditorView.tsx`**（3 处）：契约编辑
    两条 amber 警示 + 一条 emerald 保存 → warning / success。
  - **`WorkshopModelAdapterModal.tsx`**（3 处）：空态提示（amber）+ ok/err
    消息 → warning / success / destructive。
  - **`WorkshopStageNav.tsx`**（1 处）：全部完成 ratio 指示（emerald）→
    success-strong。

## Notes

- **P71 基线 146 → 115**（本会话累计 230 → 215 → 200 → 183 → 146 → 115）。
- 有意视觉 delta：
  - `bg-*-100` Tailwind 浅底（emerald-100 / red-100 / amber-100）→
    `bg-{token}/15` 或 `/10` opacity 底 + `text-*-strong` 深字。**浅底 + 强字**
    的语义不变，但**深浅两态都由 token 内部推导**——不再需要每处手写
    `dark:text-*-300` 兜住暗色（这正是 P71 存在的理由）。
  - `ExtractToolbar` request 由 indigo 归 info（蓝）——与 raw-cli
    「原始流」同一族、语义清晰。
  - `FinalComposer` 里 workshop 琥珀 `bg-amber/15 text-amber` **保留不动**：
    `--color-amber` 是 workshop 域自有的**待处理**装饰色（globals.css 里
    注释「workshop 徽章/按钮」），非状态色、也不命中 P71（无 `dark:`），
    与相邻 `bg-success/15 text-success-strong` 一起构成"琥珀 = 进行中、
    success = 完成"的两态语义。
- 剩余 115 处分布：`project-canvas`(30) / `app/(main)`(18) /
  `VideoQueueModal.tsx`(10) / `BrowserStatusBar.tsx`(5) / `FilmStudio.tsx`(5)
  / `ModelLibrary.tsx`(5) / `workflow-editor`(5) / `film-studio-config.ts`(4)
  / `training-studio-config.ts`(4) 等。下一批候选 `project-canvas` 域。
