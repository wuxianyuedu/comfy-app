## Changed

- oxlint `unicorn/relative-url-style` 全仓清零：3 处 / 3 份（#2775）。
  `new URL("./x", import.meta.url)` 去掉 `./` 前缀 —— 相对路径在 `import.meta.url`
  这个基准下解析结果不变（三处都是同目录文件名，没有 `..` 与绝对路径参与）。
  落点全在「按源码读」的契约用例里，跑过这 3 份用例（46 条）确认读到的仍是原文件。
