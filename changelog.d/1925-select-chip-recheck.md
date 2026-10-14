## Fixed

- **`WorkflowNodeJsonPopover` 的 RAW / 执行 两个页签曾永远同时高亮（ISSUE #1925 复查）**：`const active = tab === tab` 是自比较恒真 —— map 的参数名 `tab` 遮蔽了 `useState` 的 `tab`，状态判据根本没接上。表现是两枚页签的 `aria-selected` 都为真、描边与底色也都按「选中」画，用户看不出当前是哪个视图。修法是把 map 参数改名 `key`、让 `active` 真判（`tab === key`）。这比「悬停翻色」那一族硬得多：不是样式弱，是**判据断了**。

## Changed

- **「一排里选一个」收口第四批：重推全库复查（ISSUE #1925）**。前三批之后仍有两类落点漏网 —— 这一批是**从零重推**（不只看上一批点过名的），结论是 4 处收口，其中一处是真 bug。
  - **`ui/image-viewer` 的缩放档位**（适应窗口 / 原始大小）→ `ui/select-chip` 的 `compact` 档。旧形态是两枚 `aria-pressed` 的 `ghost` 按钮 —— 语义说错了一半（`aria-pressed` 是「这个开关开着吗」，而这一排只能选一个），且选中档只给 `bg-surface-2` 底色、**没钉字色悬停**。顺带把第三档 `manual`（滚轮 / ± 按钮缩出来的自由倍数）的合法状态说清：那时两枚都不选中。
  - **`studio/VideoQueueModal` 的「生成队列 / 批量提交」** → `segment` 档。旧形态钉了选中底色（`hover:bg-surface-2` 与常态同值）却**没钉字色**，`ghost` 的 `hover:text-foreground` 仍在 —— 划过已选中那枚时只有字色被翻掉。
  - **「网格 / 列表」密度切换 ×3**（画布历史抽屉 / 画布素材抽屉 / 素材库）→ 新基元 `~/components/ui/display-density-toggle`。三处**逐字相同**（连 `Hint` 文案与三元里的 `bg-surface-2` 都一样），是 §12.12 的孪生对 —— 修法是抽共享，不是三处一起改。这一族是**图标按钮版**，不是 chip，所以没硬塞进 `SelectChip`。
  - 判据：新增 5 份用例（`ui/display-density-toggle.test.tsx`、`studio/VideoQueueModal.test.tsx` 两份新建；三处落点各补一条）。**做了 4 组负对照**，把实现分别 revert 回去，命中 **2 / 2 / 3 / 7** 条全红。
  - 一处**读法修正**（不是它锁的那件事）：`HistoryPanel.test.tsx` 原来用 `getAllByRole("radio")` 全局查 —— 同屏现在还有「显示密度」那一组 radio，所以两处断言限定到自己的 `radiogroup` 里（口径不动，只收窄作用域）。

## Docs

- 规范 §16.2.4.75 的落点登记表新增第四批 4 行，并补一条注：**「按批收口」还不够 —— 每批都要从零重推全库，第三批之后仍有 4 类漏网、其中一类是真 bug**；同时记下「图标密度切换」这一新形态与 `display-density-toggle` 基元。
