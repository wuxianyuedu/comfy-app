## Changed

- **REST 接口的错误信封收敛为唯一出口**：15 个 route / 19 处此前各自手写同一段字面量 `{ error: { code: "auth.required", message: "未登录或会话已失效" } }`（与 `lib/core/errors.ts` 的 `AuthError` 默认值逐字相同，改文案要改 18 处），现统一走 `server/lib/error-response.ts` 的 `unauthorizedResponse()` / `errorResponse(err)`：信封形状由核心层 `toErrorEnvelope()` 决定，本文件只做框架适配，`AppError` 子类自动带上其 `code` 与 `httpStatus`。新增防回潮门禁：`src/app/api/**` 不再允许出现 `error: { code: ... }` 字面量。

## Removed

- **删掉零使用的 `lib/core/result.ts`**（89 行 `Result` 类型 + `Ok`/`Err`/守卫/`mapResult`/`flatMapResult`/`unwrapOr`）：全库生产代码、测试、脚本零引用。各处「可能失败」的边界用的是判别式联合 `{ ok: true, ... } | { ok: false, ... }`（`lifecycle.ts` / `llm/usage-test.server.ts` / `agent/types.ts` 等），其成功分支还携带 `base` / `detail` 等领域字段，与 `Result<T, E>` 的 `value` 单值形状并不通用 —— 泛型化只会把具体信息压成 `T`，所以是「另起一套」而非「本应复用却自己实现」。

## Fixed

- **`lib/materials.ts` 参数名遮蔽模块级常量**：`MATERIAL_FOLDERS.map((MATERIAL_FOLDERS) => ...)` / `.find((MATERIAL_FOLDERS) => ...)` 里参数与模块常量同名，读代码时无法判断 `MATERIAL_FOLDERS.id` 指的是哪个。参数改名为 `folder`（行为等价）。
- **`lib/core/errors.ts` 文档引用了不存在的模块**：`{@link ./api}` 在 `src/lib/core/` 下并无 `api.ts`（TypeDoc 模块列表也没有），且 `toErrorEnvelope` 当时零生产调用方。文档改为指向真实出口，并写明 REST 侧统一走 `server/lib/error-response.ts`。
