## Fixed

- MCP 侧 workshop API 配置缓存永不失效：设置页（Next 进程）改了 apiKey/endpoint，MCP 这个长驻进程永远读旧值直到重启（#4231）。补上与 Next 侧 `api-channel.server`（ISSUE #3836）同一机制的文件指纹失效（sha1）。用例：外部改写后下一次读取拿新值、文件不变复用缓存、删除回落默认。
