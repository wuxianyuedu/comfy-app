## Fixed

- executor-cli 的 `markRunning` / `updateProgress` 落库失败被 `.catch(() => undefined)` 完全吞掉，与 executor-ws 同名路径（失败有 warn）口径不一，排障时「RUNNING 没写上 / 界面进度不动」无线索（#4229）：两处 catch 补 cliWarn（fire-and-forget 语义保留）。注：这两处是 executor-cli 注入到 envelope parser 的闭包，与既有注入同样无直测面（parser 流层有测试、注入层不起真进程），改动为一行日志通道，无新增用例。
