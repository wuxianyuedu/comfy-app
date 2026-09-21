## Fixed

- **`src/lib/llm/secrets.ts` 的 `cachedKey!` 非空断言**：模块级 `cachedKey`
  声明为 `Buffer | null | undefined`，但 `loadOrCreateKey` 里三处赋值全产
  `Buffer`、从未赋 `null` —— `null` 是**死类型成员**。于是 `cachedKey !== undefined`
  之后仍剩 `Buffer | null`，`loadOrCreateKey(): Buffer` 的返回契约只能靠 `!`
  兜住。这是「用非空断言遮类型声明本身写错」的一族：`!` 让人误以为运行时
  真有可能是 `null`，实际只是声明多写了一档。把 `| null` 从声明里去掉，
  非空断言一并撤除；行为、加解密路径、错误处理都不变。类型层收紧。
