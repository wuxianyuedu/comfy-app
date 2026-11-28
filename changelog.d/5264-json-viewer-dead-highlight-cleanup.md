## Removed

- 清理 `json-viewer.tsx` 里永不写入的行级命中标记死代码（ISSUE #5264）：移除 `clearPreviousHighlights()` 中对 `.json-view--pair[data-jv-hit]` 的清理，以及 `ensureHighlightCss()` 里对应的两条 pair 行级 CSS 规则。这两处是「行级 + 子串」双标记方案收敛到「仅子串」后的残留，运行期从不命中；真正生效的 `<mark class="jv-hit-sub">` 子串着色与其 active 态不变。补一条用例钉住注入的 CSS 只含生效规则。纯清理，行为与像素不变。
