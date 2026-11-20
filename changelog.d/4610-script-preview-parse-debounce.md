## Fixed

- **剧本预览逐键全量 markdown 重解析加 250ms 防抖（#4610）**：
  `useMarkdownHtml` 的解析输入改走新地基 hook `useDebouncedValue`
  （`src/components/ui/use-debounced-value.ts`）——编辑态文本本身零延迟，
  只降「进解析的那条路」的频率：连续敲键只解析最后一次（250ms 窗口），
  长剧本输入不再每键全量跑 marked + DOMPurify。防抖窗口内预览继续显示
  上一份已解析结果（慢半拍不闪空）；动态 import 缓存（#4384）与空串
  输入闸语义不变。两个调用点（剧本编辑器预览、工坊阶段剧本预览）同批受益。
