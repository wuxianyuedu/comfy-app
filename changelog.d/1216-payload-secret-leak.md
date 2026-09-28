## Security

- **分发产物不再携带开发机的 LLM 密钥与本机设置**（P3 §5 · Phase 3-E2a，ISSUE #1216 摸底量到）。`next build` 的全项目追踪会把仓库根的运行期目录顺手拷进 `.next/standalone`，实测里面躺着 `data/llm-secret.key`（`src/lib/llm/secrets.ts` 写的本地密钥主密钥）与 `data/app-settings.json`（整机设置）。此前 `src-tauri/static` 没有装配者，泄漏停在开发机；本刀接通 `bundle.resources` 之后这一层**真的会分发出去**——不解包也拿不到，解包即得。判据两条：
  - `scripts/standalone-private-inputs.mjs` 的 `PRIVATE_INPUTS` 逐条点名那两份（与 `.env` / `db.sqlite*` 同一类：开发机私有输入；两处写入方都有 `mkdirSync(..., { recursive: true })`，剔除不改变任何行为）。
  - `src-tauri/static` 的顶层改成**默认拒绝**（`STATIC_ALLOWED_TOPLEVEL` + `isStaticPathAllowed()`，复制前判、落盘后再兜一次）。黑名单永远追不完——#1217 记的正是「`outputFileTracingExcludes` 里逐条写了 glob 却整份未生效」。同批挡掉 `src/`（11.7 MB，含 377 个测试文件）、`changelog.d/`（3.3 MB 内部变更碎片）、`Comfy APP.lnk`、`build-launcher/`、`next.config.js`。
  - `src` 按 `RUNTIME_SRC` **逐文件**放行一份：`lib/process/kill-process-tree.ts`——`scripts/reap-process.mjs` 与 `scripts/dev-launcher.mjs` 运行期 `await import` 的就是它（硬规则 3 的平台机制单点）。清单与两处说明符由 `tests/standalone-runtime.test.ts` 逐字比对：漏登记 = 桌包回收链静默断；将来给那份文件加 `enum` 之类的非可擦除语法，红的是用例而不是用户的双击。
  - 顺带把 `OAUTH_PLACEHOLDER` 与 `newAuthSecret()` 收成一个定义点（新增 `scripts/launcher-core/standalone-runtime-env.mjs`，`scripts/env-init.mjs` 改为 import）：原先两侧各写一份字面量，分叉的后果是「dev 检出的鉴权配置形状」与「桌包里的」不同，而两侧都能正常启动、没有任何判据会红。
  - `tsconfig.json` 补 `src-tauri/target` 排除：声明 `bundle.resources` 之后 Tauri 会把载荷摆到 exe 旁边（`target/release/static/**`），里面含应用的 TS 源——不排的话 `pnpm typecheck` 检查的是一份**构建产物副本**，报出来的类型错误指向没人维护的地方（实测撞到过）。
