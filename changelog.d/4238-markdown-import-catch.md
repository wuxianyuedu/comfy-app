## Fixed

- 剧本预览的 markdown 渲染器动态 import 无 `.catch`：网络分块加载失败时 rejection 无人接、预览永久空白且无重试入口（#4238；`beginStaleRun` 守卫本来就有，缺的是失败路径）。补失败态 + console 留痕，下次 `text` 变更自然重触发。用例：import 拒绝断言失败态可见、rejection 不冒出。
