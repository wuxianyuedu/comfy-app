## Fixed

- `NativeSelect` 的 option / optgroup 弹层底色与文字改走主题令牌
  （`bg-node` / `text-ink-field`，与全局 `select option` 规则同源），
  不再用随 OS color-scheme 解析的 `Canvas` / `CanvasText` 系统色 ——
  后者在 WebView2 上会脱离应用主题自行变脸（#3720 第 3 条反馈的深灰底）。
