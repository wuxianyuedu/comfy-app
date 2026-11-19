## Fixed

- 测试模型页的「请求预览」（dryRun）请求体漏了 `kind`，中转按 kind 分流时两头都不中 → 选完模型即报「kind 必须是 image 或 video」。预览出口 `apiPreviewRequest` 现在显式带上当前用途的 kind（#3985）。
