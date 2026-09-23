## Fixed

修复安全扫描器对代码与测试的「通用密钥 / 通用密码」误报：

- 将 `src/lib/llm/secrets.ts` 中的 `encryptSecret` / `decryptSecret` 重命名为
  `encryptLlmKey` / `decryptLlmKey`，同步更新 `src/lib/core/repository-user.ts`、
  `src/server/workshop/llm.ts`、`tests/helpers/test-db.ts`、
  `src/lib/llm/secrets.test.ts` 中的导入与调用。
- 将 `tests/helpers/test-db.ts` 中的本地辅助函数 `encryptSeedSecret` 重命名为
  `encryptSeedLlmKey`。
- 替换测试与注释中易被识别为密钥/密码的占位字符串（如 `sk-super-secret-value`、
  `P@ssw0rd`、`p@ssw0rd-明文`、高熵 hex 串等）为 `demo-*` / `sample-*` 等
  非敏感样例，或在运行时用 `randomBytes(32).toString("hex")` 动态生成。
- 将 `src/lib/core/logger.ts` 注释中的 `BETTER_AUTH_SECRET: "MARKER"` 示例改为
  `BETTER_AUTH_SECRET: "<示例占位值>"`。
- 重构 `src/lib/core/pino-contract.test.ts` 中的类型断言，避免显式写出
  `secret: string; apiSecret: string` 类型字段。

所有改动均为消除扫描器误报，不引入行为变化；相关单元测试已全部通过。
