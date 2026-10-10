## Fixed

- **面板里的 ERROR 不再把调用方的文案当成命名空间（ISSUE #1696）**。用户报的两行
  `[app] 服务端错误 {"ns":"e"}` 与 `[app] （无可读文案；字段：password, token） {"ns":"login"}`
  都**没有正文**：知道出错了，却看不出是什么错。根因是 `src/lib/core/logger.ts` 的 ERROR 镜像
  把「第二个字符串参数」当作命名空间候选 —— 这条假设站不住：本仓库的 `wrap()` 一律以
  `(fields, msg)` 调 pino，于是镜像看到的 `(obj, msg)` 里第二个字符串**就是调用方的文案**
  （`log.error("e")` → `inner.error({}, "e")`、`log.error("login", {password, token})` →
  `inner.error({password, token}, "login")`），被塞进 `ns` 槽后文案整条丢失。
  现在命名空间**只认对象里的 `ns` / `event`**，都没有就回落日志器自己的绑定名（`app` / `trpc`，
  比无信息量的 `server` 有辨识度）；文案优先级改为「字段里的 `msg` / `err.message` >
  第二个字符串 > 键名清单 > 占位句」——键名清单此前藏在取文案的函数里，压过了第二个字符串，
  这是文案丢失的第二半。补 3 条走完整调用链（`createLogger` → pino）的回归用例。
  顺带堵住同一通道的污染：镜像默认落点由 `LOG_ROOT = process.cwd()/log` 推出，而 vitest 的
  cwd 就是仓库根，`logger.test.ts` 漏传 `mirror` 会把用例正文写进 `log/current/services/`
  （规范 07 §7.18.2.1 早有纪律、此前无执行者）。现在 `createPinoLogger` 在 `process.env.VITEST`
  下把默认镜像换成空转，`logger.test.ts` 的辅助函数也补上 `mirror`。
