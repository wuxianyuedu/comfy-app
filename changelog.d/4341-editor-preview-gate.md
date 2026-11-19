## Fixed

- **剧本编辑器渲染期成本收敛**（#4341）：`previewHtml` 的 `useMemo` 只依赖
  `value`、与 `showPreview` 无关——预览关闭时结果不渲染，但每个按键仍同步跑
  `marked.parse + sanitize` 全量管线；页脚「N 行 · M 字符」统计每渲染重算未
  memo。现在 `showPreview` 进依赖（关着给空串、`EditorBody` 只在预览分支消费
  它），页脚统计收敛进 `useMemo`——长剧本连续打字不再每键两次全量扫描。行为
  零变化，组件用例两条钉住「预览关闭不跑管线 / 统计随输入更新」。
