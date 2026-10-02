## Fixed

- **控制台执行命令报「spawn pnpm ENOENT」**（ISSUE #1327 反馈）：面板里跑 `pnpm exec tsc --noEmit` 这类命令，回的是一句 `无法启动命令：spawn pnpm ENOENT`。
  - **根因**：`src/lib/console/console-run.ts` 把用户敲的可执行名（`pnpm` / `git` / `node`）**原样**交给了 `spawn`。Windows 上 Node 的 `spawn` 不认 PATHEXT —— `pnpm` 在 PATH 上是「无扩展名 shim + `pnpm.cmd` + `pnpm.ps1`」三个形态，裸名字一个都起不来；而 `pnpm.cmd` 又是 Node 起不了的（只有 `cmd.exe` 会解释批处理），真能起的是 `pnpm.ps1` 经 PowerShell。同一台机器上跑得好好的启动编排早就有这份判据，控制台却绕过了它。
  - **修法**（硬规则 24：复用在先，不造第二轮子）：把可执行形态判据从 `scripts/launcher-core/shell.mjs` **下沉**到 `src/lib/process/executable-resolve.ts`，启动编排与控制台 `import` 同一份实现（`shell.mjs` 只 re-export，既有调用方与 39 条用例的导入路径一字不变）。控制台起进程前先过 `resolveCommandInvocation()`，`start` 帧里的 `file` / `args` 报的是**真正要起的那一份**（`.ps1` 形态时是 PowerShell 宿主 + `-File`，排障时才能看出「为什么多了一层」）。
  - **`spawn pnpm ENOENT` 这条文案本身也没用**：它看着像参数写错，而用户真正要知道的是「这台机器上有没有这个命令 / 这个应用进程的 PATH 里有没有它」。所以 `resolved: false`（PATH 上查无可用形态）时给一句点名该命令、说清「已查过 PATH」、并指出下一步的话；解析过但真起不来时才带上绝对路径。
- **控制台面板回一句浏览器腔的 `Failed to fetch`**（ISSUE #1327 反馈）：命令根本没到服务端时，结论条只写着 `Failed to fetch`，用户分不出「应用服务没起来」与「我命令写错了」。改用全库唯一的错误文案出口 `~/lib/error-message` —— 它能把这个浏览器原文翻成「网络请求失败，请检查应用服务是否正在运行」；读流中途断掉（服务重启）那条路同样改过来。

## Tests

- 新增 `src/lib/process/executable-resolve.test.ts`（13 条）：候选扩展名顺序（POSIX 退化为无扩展名）；形态判据按**内容**而不是扩展名（`#!` → shebang、`@echo` → batch、MZ 头 → binary）；`resolveCommandInvocation` 的四档 —— POSIX 找到就用绝对路径、查无此命令 `resolved: false`、Windows 上 `.cmd` 垫底且选中经宿主回退的 `.ps1`、只有 `.cmd` 且无宿主时判「PATH 上没有可用形态」；`whichCommand` 跳过不可用候选、无执行位判否、**缓存按 env 分键**（换 PATH 不许串扰）。
- `src/lib/console/console-run.test.ts`：新增「可执行文件不存在时的文案要说清查过 PATH」与「`start` 帧报的是解析后的路径（不再是裸名字）」两条；`console-client.test.ts` 把「网络错误 → 带原文」改成「翻成人话」，钉住不再把 `Failed to fetch` 甩给用户。

## Docs

- `docs/guide-console.md` 补一节「为什么命令名要先解析」：说清三个形态与 Node 起不了批处理这两件事，以及「找不到命令」那句文案的两种现场。

## Gates

- `src/lib/process/executable-resolve.ts` 按 §18.4 第三类登记进 `tests/lib-node-only-declarations.test.ts` 的 `PURE_NODE_HOSTS`：它**必须能被 `.mjs` 静态 import**（`shell.mjs` 是纯 Node 启动编排的一环，`server-only` 的入口就是一句 throw，加上去 `pnpm dev` 直接崩在加载阶段）。
- 机械前提写在两处文件头：Node 24（`.nvmrc` 钉死）默认开启 TypeScript 类型擦除，所以 `shell.mjs` 能静态 `import` 那份 `.ts` —— 不需要 `tsx`、不需要构建步骤；换 Node 大版本时先看那里。
