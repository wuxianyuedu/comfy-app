## Changed

oxlint `unicorn/text-encoding-identifier-case` 全仓清零（#2775）：70 处 / 33 份，编码标识统一为 Node 的规范短名（`"utf-8"` → `"utf8"`）。

只改字符串字面量，不碰逻辑：`fs` / `Buffer` / `Stream.setEncoding` 与 `PYTHONIOENCODING` 均接受大小写与连字符变体，Python 侧同样认 `utf8`。`--fix` 直接收敛，无手工补丁。
