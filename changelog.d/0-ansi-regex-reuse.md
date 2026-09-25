## Fixed

- **日志 ANSI 解析每行编译一次正则（`src/lib/log/log-ansi.ts`）**：`parseAnsiSegments`
  对**每一行**日志调用一次，原先每次都 `new RegExp(SGR_RE.source, "g")` —— 而模块级的
  `SGR_RE` 本来就带 `g` 标志。改为直接复用它并在开头归零 `lastIndex`（模块里其它使用点
  同款写法）：一屏数百行、且这段是同步计算，直接压在渲染路径上。
