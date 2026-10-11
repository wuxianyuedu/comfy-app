## Changed

- **设置页从「一屏一节」改成一页到底：全部小节铺在同一根滚动条里，导航退回到「目录」的角色**（ISSUE #1722）。用户反馈「设置页的界面内容要做成一个滚动条可以从头滚动到尾，然后左侧选中项可以跟随滚动变化，每一项在右侧展示区也要有对应标题」。
  - **此前的问题**：导航点一下把右侧换成另一份 JSX（`c.section === "…" && <XxxSection/>`），于是「从头看到尾」做不到 —— 想比较两个分区的取值得来回点；而「现在读的是哪一节」只由导航的 `aria-current` 与标题行那句摘要表达，**正文里一个标题都没有**（滚到中段没有任何本地线索）。
  - **现在**：外壳把**所有**分区节铺在同一个滚动容器里（每个节带 `id="settings-<分区>"` 与 `scroll-mt-*` 落点补偿），左侧导航是**目录** —— 点一项平滑滚过去，手动滚动则高亮跟着走。
  - **滚动跟随**由 `IntersectionObserver` 判「哪一节压过了顶线」：`rootMargin` 把容器可视区**压成上沿往下一条线**（上收 `SECTION_TOP_LINE_PX` + 下收 `-100%`）。⚠️ 下沿必须一起收 —— 只上收会让「进入」退化成「看得见」，而整屏同时看得见三四个分区，「最后一个看得见的」是**屏底**那一节，实测症状是页面停在最顶上而高亮已经跳到第四段。取压过线的那一节里**文档顺序最后一个**作为当前分区。
  - **每节都有标题**：外壳为每个分区节渲染 `SettingsSectionHeading`（`.u-title-stage` 档 + 一句话说明），字从 `SETTINGS_SECTIONS` 取 —— 导航项与正文标题**同源，不可能漂移**。
  - **正文顺序 = 目录顺序**：新增 `SETTINGS_SCROLL_ORDER`（从 `TREE_GROUPS` 展开派生）。此前正文按 `SETTINGS_SECTIONS` 排，而导航按分组重排（模型 / 后端 / 数据 / 应用 / 诊断），两者不同序 —— 一页到底之后按目录往下读会跳节。
  - **外壳的两个形态收进判别联合**：`sections: Record<Section, ReactNode>`（就绪，**不许缺项** —— 少一节只是少渲染一个 `<section>`，运行时静默）或 `fallback: ReactNode`（加载 / 失败 / 未就绪三态，铺 9 份同样的占位等于把同一句话重复 9 遍）。漏项与「两头都给 / 都不给」在 `tsc` 就红。
  - 分区导航仍是左侧那棵竖向的树（ISSUE #1694 的形态未动）。

## Tests

- `src/components/settings/SettingsShell.test.tsx`：新增「导航树展开顺序 = 页面滚动顺序（不漏不重，且 DOM 里的 `<section>` 顺序真按它排）」、「全部小节铺在同一页且每节有与导航同源的 `h2` 标题」、「点导航是 `scrollIntoView` 到那一节而不是换内容」、「给 `fallback` 时不渲染分区列表（占位只出现一次）」。既有四条（无「返回」出口 / 导航不漏不重 / 树的父子两层 / `aria-current` 恰好一项）仍全绿。
- `src/components/settings/use-section-scroll-spy.test.ts`（新增，4 条）：用可控的假 `IntersectionObserver` 钉住「越过顶线的最后一节成为当前分区」、「没有一节越线时保留当前值」、「点导航立刻通知并滚到那一节」、「环境没有 `IntersectionObserver` 时退化而不是崩」。
- `tests/db-backup-wiring.test.ts` 的「设置页接线」一条跟着改锚：一页到底之后不再是 `c.section === "backup"` 的条件渲染，而是 `sections` 映射里按分区 id 取的那一格 —— 断言改成「`backup:` 那一格存在且值是 `<BackupSection`」，「这一节真的被渲染出来」这件事没变。
- 关联：新增 `src/components/settings/use-section-scroll-spy.ts`（滚动跟随的唯一实现）、`SettingsShell.stories.tsx` 补 `Long`（每节撑高，验证滚动跟随）与 `LoadingFallback` 两屏。
