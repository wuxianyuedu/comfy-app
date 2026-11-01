## Fixed

- `tests/commit-scope-advice.test.ts` 两条源码文本钉在 #2848（b6e7494f）把改动面拆成
  `segFiles` / `chunk.files` 之后失效：`const affectedCount = files.filter` 钉与
  `await runChunk(chunk,` 锚点都再也匹配不上，而这份用例不在固定清单里，只在有人动
  `scripts/run-affected-tests.mjs` 时才被受影响闭包拉到 —— 于是它红在基线上对绝大多数
  提交隐形（#2905）。
- 两条断言改钉语义锚点而不是变量名：`affectedCount` 只要求「从某个已有数组的 filter
  结果来」（新起一次 git 会换个形态、照样红）；建议的调用点改成
  `await runChunk(` 后不接空数组（仍排除 `--full` 档的 `runChunk([])`）。
