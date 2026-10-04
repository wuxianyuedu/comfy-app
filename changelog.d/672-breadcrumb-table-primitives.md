## Changed

- **零引用 UI 基元再复查一轮：按形态接上 `ui/breadcrumb` / `ui/table` 两条**（ISSUE #672）。§16.2.4.6 按形态复查过 7 条零引用基元；本批重新数得 **20 条**业务侧零引用，其中 14 条在本应用里确实没有对应形态（桌面应用的顶栏不是 `Menubar` 等），只接上真有落点的两条：
  - **路径行**：素材库抽屉 `MaterialLibraryPanel` 与资源库页 `ResourceLibrary` 各自手搓一份「`breadcrumbSegments.map` + `i > 0 && "/"` + `isLast ? span : Button`」，class 串逐字相同（只有分隔符的 `mx` 档不同）—— 抽成 **`~/components/ui/breadcrumb-path` 的 `BreadcrumbPath`**（建在 `ui/breadcrumb` 的整套 slot 上），两处调用点各自删掉那份手搓渲染。收的不只是排版：手搓的 `span` + `/` 里既没有 `ol`/`li` 的层级、也没有 `aria-current="page"`，读屏器读到的是一串无结构文本。`WorkflowEditorTopbar` 那份**不迁**（它是页头标题：18px 粗体首段 + 紫色选中药丸 + `Hint`/`title=`，迁过去外观会变，§16.2.4.2 第 9 条）。
  - **表格**：尺寸表配置弹窗 `SizePresetTableModal` 的裸 `<table>` + `<thead>`/`<tr>`/`<td>` 换成 `ui/table` 一族 —— 这同时是 `ui/table` 全库零引用状态的**第一个消费点**（它自己的 story 里写着「整族没被用过」）。

## Added

- **两条硬闸判据 **P84 / P85**（`scripts/check-ui-primitives.cjs`，82 → 84 条全部须为 0）**（ISSUE #672）：
  - **P84 视图层手搓面包屑** —— 形态锚，两件同现才算：① 一个文本只有 `/` 的分隔符 span；② 一个带末尾判定的段数组 `map`。只看 `/` 会把分数与路径字面量算上、只看 `.map(` 会把任何列表算上。
  - **P85 视图层手写 `<table>`** —— 锚 `<table` 标签起始形态（同 P76 对 `<select` 的口径，`tableData` / `Table` 组件名不误伤）。
  两条都带正例用例（喂一段手搓代码断言被数到并阻断）—— 「0」只有在数得出来时才可信（P82 粗锚漏计的教训）。
