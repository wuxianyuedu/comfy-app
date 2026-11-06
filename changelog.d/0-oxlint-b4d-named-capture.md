## Changed

- **B4 子批 4：20 份 / 39 处 `eslint/prefer-named-capture-group` 清零**（判决面删掉这 20 份路径行）。
  其中命名组 25 处（含消费点同步：`m[1]` / `.at(1)` → `m.groups.<name>`、`"$1 $2"` → `"$<a> $<b>"`、
  替换回调第 5 参加解构），非捕获组 14 处（组值本就没人读，改 `(?:...)` 即可）。
- 改动集中在 `src/lib/comfyui/`（desktop-instance 启动参数切分、extra_model_paths 解析、
  executor-finalize 尺寸解析、node-titles 拆分、socket inode 识别）与
  `src/components/`（脚本 Markdown 解析、UI 测试的正则断言）；正则匹配语义未变。
- 台账：B4 行改「清账中（子批1–4：185 份 / 593 处已清）」。
- 清账总账：#3181（本批挂 `Refs`）。
