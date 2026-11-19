## Fixed

**去掉 `whichCommand` 的进程内共享记忆化**（code-scanning `js/shell-command-injection-from-environment`，
ISSUE #3327 / 告警 #13、#14 的残余数据流）：

- 移除模块级 `whichCache` 与 `clearWhichCommandCache()`（`src/lib/process/executable-resolve.ts`）：
  每次 `whichCommand` 都按当前 `PATH × PATHEXT` 现解析，不再有一条「这次解析的产物被下一次按名字读回」的跨调用通道。
  连带更新 `scripts/launcher-core/shell.mjs`（不再 import / re-export）、`e2e/support/fake-comfyui-executor-env.mjs`
  与三份用例里「先清缓存」的前置（现在不需要了）。

- **写入点与读取点**（改动前）：只有 `executable-resolve.ts` 一处 `whichCache.set(key, result)`；
  读取也只有同一函数的 `whichCache.get(key)`。`result` 只可能来自
  「`envVar(PATH)` 拆出的目录 × `executableExts()` 拼出的名字 → `isFile` → `usableCommand` 真起一次」这条链，
  不存在任何 env / argv / 配置分支能把任意外部值写进这张表。

- **为什么它是扫描器的误报**：CodeQL 的数据流把 `src/lib/console/console-run.test.ts:40/52` 的
  `process.execPath`（测试夹具）当成源，经 `console-run.ts:167 opts.file` → `pnpm-resolve.ts:362/371` →
  `executable-resolve.ts:244/264` 的候选 → **`executable-resolve.ts:287` 的 `whichCache.set`** →
  `downstream.mjs:189 whichCommand("pnpm")` → **`executable-resolve.ts:255/257` 的 `whichCache.get`** →
  `spawn` 参数。断点在「它把 `Map` 当**键不敏感**」：`whichCache` 的键含 `name`，测试夹具那次写进的是
  `process.execPath` 自己的键，`"pnpm"` 的读取不可能命中它。**要控制这张表里的值，先得能在进程内改模块状态**
  （或控制 `PATH` 并在其中写入文件）——两者都不是本代码给出的输入面。

- **为什么去掉而不是加校验**：实测（本机 Windows）缓存命中 0.02ms、冷解析 180~220ms（一次 `pnpm --version`
  探针进程占绝大部分）；一次运行里同名解析通常只有 1~2 次（启动编排 2 次：装依赖 + 起 dev server；
  `dev.mjs` / `start.mjs` / `quality-gate` 各 1 次，后者解析一次后把形态传给每一步）。省下的最多是一次探针，
  远小于这些进程本身的运行时长，故按「收益很小就去掉共享缓存」取舍：通道消失、行为不变，且 `PATH` 在本进程内
  被改动（装完 pnpm 再探测）时新结论立即生效。

**运行时行为**：

- 合法 `PATH` 与合法名字的解析结果逐字不变（仍是命中候选的绝对路径 / 宿主形态）。
- 重复调用会多付一次解析（`PATH` 扫描 + 必要时一次 `--version` 探针），不改变选中谁。
- `ci-install-deps.mjs` 改完 `process.env.PATH` 后，同一进程里紧接着的 `pnpm install` 直接看到新 `PATH`，
  不再需要「缓存过 null」那条解释（同名垫片仍保留给按名字起的新进程）。

**读数**：

- 新增 4 条定向用例（`src/lib/process/executable-resolve.test.ts`）：合法值照旧、文件删除后不复用旧路径、
  换探针立即生效、已删除的落点不会以旧值再进 `spawn` 参数（`resolveCommandInvocation`）。
- `executable-resolve` + `python-resolve` + `dev-launcher-toolchain-gate` + `e2e-python-preflight`：
  116 通过 / 13 跳过。
