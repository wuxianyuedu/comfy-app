## Added

- **ComfyUI 执行器宿主的运行时图现在随构建进产物**（P3 §5 第 2 期 · Phase 3-E1，ISSUE #1169 的第一半）。此前 `COMFY_EXECUTOR=host` 只在 dev 检出里能跑：宿主用 `tsx` 加载 `src/lib/**` 的 TypeScript 源，而 `tsx` 是 devDependency、不分发给使用者，产物里 boot 直接大声失败（`Cannot find package 'tsx'`）。现在 `pnpm build` 收尾多出三步，且顺序本身是判据：

  1. `scripts/build-executor-host.mjs`：用 esbuild 把 `src/lib/comfyui/host-runtime.ts` 那张图预编译成单份 ESM `scripts/executor-host.runtime.mjs`（实测 306 个输入、约 1.4 MB），并写机器生成的构建清单 `scripts/executor-host.build.json`（entry / inputs / externals / bytes）供门禁复算。`@libsql/client` / `ws` / `pino` 保持 external（原生绑定、可选加速模块、进程级单例），`drizzle-orm` / `zod` / `@paralleldrive/cuid2` 打进来（裁剪版 `node_modules` 顶层没有它们）。`server-only` 解析成 bundle 内的内存桩而不是 external——作为 external 会被 ESM 提升到顶部、加载即抛，破坏「没被问到就不加载」的边界；bundle 顶部再注入 `createRequire` banner，否则被包进来的 CJS 运行期 `require("node:crypto")` 会失败（这一条只有真起进程的冒烟抓得到）。
  2. `scripts/standalone-private-inputs.mjs`（既有）：宿主那两件已登记进 `RUNTIME_SCRIPTS` / `BUILT_RUNTIME_SCRIPTS`，剥离白名单不会剪掉它们。
  3. `scripts/smoke-executor-host-standalone.mjs`：**对剥离后的最终产物**冒烟——宿主三件齐、清单里每个非内置 external 都能解析、然后真起一个宿主进程（`--once` + 临时空库）跑完 boot，要求出现 `runtime inject-ok` 且没有 `boot FAILED`。

  宿主入口按**内容**决定加载哪份图：预编译件在 → 用它；不在（dev 检出）→ 走 tsx 分支。与启动形态判据同一条取向（环境开关会撒谎，文件内容不会），缺预编译件仍以 `boot FAILED` 大声失败，不会半接线地跑起来。新增回归 `tests/executor-host-artifact.test.ts`（构建链顺序 / externals 清单 / banner / `server-only` 桩 / 入口不残留裸 `../src/lib/*.ts` 导入 / 排队数诊断先过 `isSchemaReady()` / 白名单登记 / `build-desktop` 跳过与缺件断言 / 冒烟对空目录的判定 / 有真产物时的 boot 用例），另在 `check-standalone-contents.cjs` 加 `REQUIRED_HOST_FILES` 反向缺件检查（只在 `server.js` 在场时判，standalone 与 `src-tauri/static` 两层都查）。

  **本条不等于「桌包已经支持 host」**：standalone 形态不经过编排器，而拉起宿主那一步在编排器第 6.5 步里，所以产物里目前没有进程会去起这个已经能 boot 的宿主——另记 ISSUE #1216，落地前桌包里不要设这个开关。机制见规范 [launch-and-build §7.5](../docs/standards/launch-and-build.md)。
