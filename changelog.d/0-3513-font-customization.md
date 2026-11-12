## Added

- **界面字体可自定义替换（#3513）**：设置 → 外观新增「字体」分组，提供「界面字体 /
  代码字体 / 终端字体」三个文本输入框，可填入任意字体栈（如 `Inter`、
  `IBM Plex Mono`），即时生效并自动保存；每档附「恢复默认」按钮，回落到
  `globals.css` 的原字体栈。三档分别写入 `--font-sans` / `--font-code` / `--font-mono`，
  由 `AppearanceBootstrap` 在首帧应用到 `<html>`，跨路由、刷新后仍保持。默认值保持
  项目原有字体栈不变（不按截图换成 Inter 等），因此老用户升级后外观零变化。

## Changed

- `AppearancePrefs` 新增 `interfaceFont` / `codeFont` / `terminalFont` 三字段；
  `globals.css` 在 `@theme` 主块新增 `--font-code`（代码块专用，独立于 `--font-mono`），
  `.cb-code-block` 由写死字体改为引用 `var(--font-code)`。`parseAppearance` 对字体档
  采用「缺省 / 空串只回落该档」的口径，不再连坐圆角与字阶的整体回落。
