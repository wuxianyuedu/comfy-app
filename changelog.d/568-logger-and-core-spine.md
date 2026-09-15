## Changed

- **服务端日志只剩一条通道**：`src/lib/core/logger.ts` 此前是「零依赖自研日志器」——自己拼行、走 `console.log/error`、**没有任何脱敏**，而 `src/server/lib/logger.ts` 是 pino（`REDACT_PATHS` + 密钥值形状守卫 + ERROR 镜像进「应用运行」面板）。两条通道使用面都不小（core 侧被 `repository-base` / `events` / `container` 用，pino 侧 31 个文件），后果是同一件事两种口径，且规范 07 §7.18.2.1 的脱敏契约在其中一条上**根本不成立**（`repository-base.ts` 的 `log.debug("update", patch)` 多带一个 `token` 字段就原文落盘）。现在 `core/logger` 只是 pino 的**薄封装**，接口（`debug/info/warn/error` + `child(ns)`）与旧版逐字一致、调用方零改动，而脱敏 / 级别过滤 / ERROR 镜像 / pretty 输出只剩一份实现。新增门禁 `tests/single-logger-channel.test.ts`：服务端库代码（`src/lib/**`、`src/server/**`）直接写 `console.*` 即失败。
- **仓储取用统一为直接 import，DI 容器（`lib/core/container.ts`）移除**：容器与直接 import 取到的是**同一个单例**（`register("x", () => x)` 原样返回模块单例，全仓没有任何一处 `register(..., mock)`），而直接 import 是 29 个文件的既成形态、容器只有 2 个文件 / 10 处调用 —— 两条路并存时「容器是少数派」，注释里承诺的「可替换单例、便于测试」从未被使用（测试用 `vi.mock` 模块本身，本来就绕过容器）。`projectRouter` / `workflowModelRouter` 改为直接 import 仓储；新增门禁 `tests/container-single-access.test.ts`（`src/` 内禁 `container.resolve(` 与 `lib/core/container` 引用）。
- **`lib/core/config.ts` 不再假装是「集中配置」**：它的模块注释写着「任何模块都应 `import { config }` 后读取，而不是再直接读 `process.env`」，而现状恰好相反 —— `src/lib` 里直接读 `process.env` 的地方有 30+ 处，其中绝大多数改不动（schema 只覆盖 7 个变量，真实用到的还有 `COMFYUI_PATH` / `COMFY_CLIENT_ID` / `LLM_*` / `FFMPEG_BIN` / `COMFYAPP_TASKKILL` 等一大批）。现降级为**类型契约 + 默认值**：导出 `CONFIG_ENV_DEFAULTS`（`COMFYAPP_PORT` 默认端口、`COMFYUI_BASE_URL` 默认地址，两者都被 schema 直接引用，与 `endpoints.ts` 同源），并写明「新增配置项只在两侧都要读时才放这里」。新增门禁 `tests/core-spine-single-source.test.ts`：模块文档不许再出现那类与现状相反的承诺句式。

## Fixed

- **`lib/core/index.ts` 的 barrel 回环少一个入口**（同族问题见 #574 登记）：移除 `export * from "./container"` 后，`core/index.ts` 与 `config` / `events` 之间的 `export *` 回环减少一组；barrel 里补上「这里为什么没有容器」的说明，避免下一个人照着旧注释再加回来。
