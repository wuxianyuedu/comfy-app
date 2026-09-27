## Fixed

- **把 `src/server/db.ts` 恢复成纯 ASCII**（AGENTS 硬规则 16 / 规范 §12.4.6 的白名单模块）：
  后端合规债那一批给 `pingDatabase` 加了两行中文注释，把这个构建期模块弄脏了。后果不是
  风格问题 —— Next 的 code frame 渲染错误现场时按**字节**取「该行第 a..b 字节」，一个中文
  字符占 3 字节，端点落进字符内部就让 Rust 侧切片 panic（`end byte index N is not a char
  boundary`），整个 `next build` 被 `Panic in async function` 带走，且报错完全指不出业务
  原因；触发还是偏移敏感的，删掉别处中文能过、换个长度又能复现。机器判据
  （`tests/db-push-noninteractive.test.ts` 的「源码保持纯 ASCII」那条）因此在 master 上
  一直红。注释改回英文并在原位写明「为什么这个文件不许有中文」。
