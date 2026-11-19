## Fixed

- **`tools/start/take-screenshot.ps1` 修复头部双 BOM**（#3968）：文件头是两个
  UTF-8 BOM（`efbbbf` ×2），多出的那个使 PowerShell 解析出 2 个 ParserError、
  双击入口直接不可用；去掉多余 BOM 后恢复。
- **平台流水线形态判据放宽 `$CNB_COMMIT` 分锁**（#3968）：类锁 key 判据从
  「一律字面量」放宽为「字面量，或只带 `$CNB_COMMIT`」——该变量在 push /
  api_trigger / web_trigger 上都是 build 绑定的提交（回调 build 实测
  `sha_check=match`），按它分锁不会退化成共用一把；其余变量照旧判红，并新增
  「两个不同 commit 必须解出不同 key」的假分锁判据。
