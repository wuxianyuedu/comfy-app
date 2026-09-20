## Fixed

- **工作流编辑画布的「查看 JSON」弹窗不再有两个关闭按钮、也不再关不掉**：`ui/dialog` 的 `DialogContent` 默认会自带一枚右上角关闭按钮（`absolute top-2 right-2`），而本弹窗在 header 里又自绘了一枚 —— 两枚位置几乎重合，点下去命中的是 DOM 靠后 + 绝对定位的内置那枚，两枚之间的空隙还成了「点了没反应」的死区。同类缺陷一并排查并修复：设置页的用量测试弹窗、远程模型弹窗，以及工坊的模式契约弹窗都漏传了同一处开关。现在这四处的关闭控件只剩自绘那一枚，并补上 `aria-label="关闭"`（按钮内容是「✕」字形，读屏器此前念不出「关闭」）；`ui/dialog` 的 `showCloseButton` 也补了口径注释，说明「自绘 header 就必须传 `false`」。回归测试见 `src/components/studio/SourceModal.test.tsx`。
- **「查看 JSON」按钮的悬停提示不再宣称含 API 源码**：API 格式的支持已经下线，磁盘上只剩 RAW 一份源文件，提示文案从「查看当前工作流的 API + RAW 源码（…）」改为「查看当前工作流的 RAW 源码（…）」。
