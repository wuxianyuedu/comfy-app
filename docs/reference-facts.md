# 文档引用事实登记表（单一事实映射）

> 本文将「文档里散落的具体值」收敛为一份**稳定映射**：每个值用一个语义化
> 占位符表示，并声明它的**权威定义文件**与**提取规则**。
>
> **关键设计**：本登记表**不存值本身**——真实值由校验脚本
> `scripts/check-doc-references.cjs` 在运行 `pnpm doc:check` 时**直接从权威源
> 动态提取**。源码 / 配置才是唯一事实，本表只声明「某占位符代表哪一种值、去哪
> 个文件读」，因此不存在「登记表抄错值」的第二事实问题。改源码 → 跑
> `pnpm doc:check` → 文档里未同步的占位符会立刻报错。

---

## 1. 值类引用（端口 / 地址 / 可执行文件名）

> 这一类是文档里最容易过期、跨文档复用的**值**。分两种处理方式：
>
> - **占位符类**（`shell.*`）：文档里用占位符 `{{...}}` 替代裸值，脚本发现裸值即报错。
> - **直观值核对类**（`dev.*` 端口/地址）：文档保留 `localhost:3100` 这种直观形态
>   （可读性最佳），脚本从权威源提取当前值，发现文档值与权威不符即报错。
>   `key` 是语义标识；`placeholder` 是占位符文本（占位符类才有）；`source` 是权威定义文件；`extract` 是脚本读取真实值的方式。

### 1.1 开发端口与地址（直观值核对类，保留 `localhost:<端口>` 原文）

> **端口事实按链路拆成两条**（ISSUE #489 的根因）：应用端口不是单一常量，
> 两条链路的取值来源不同、也**经常不相等**——把它们压成一条「主端口」事实，
> 校验就失去意义（用静态值当 oracle 去核对 `pnpm dev` 语境的文档，怎么算都「一致」）。
>
> | 链路                                                                                     | 谁在监听                                                                       | 端口来源                                                                                        | 文档里的正确形态                                             |
> | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
> | **解析链**：`pnpm dev` / `pnpm start` / `pnpm tauri dev`（beforeDevCommand）/ Playwright | `node scripts/dev.mjs` → `next dev -p`                                         | `.env` 的 `COMFYAPP_PORT` → **按检出路径推导 3200~3999** → 兜底 3100（`scripts/app-port.mjs`）  | 路径推导值（本检出固定，换机器会变），或写「解析值」不给数字 |
> | **静态链**：Windows 双击链路（`app.exe` / `dev-launcher.ps1` / Rust 壳）                 | 挂在上面的解析链上，端口由壳 / 编排器注入 `COMFYAPP_PORT` / `COMFYAPP_DEV_URL` | `src-tauri/tauri.conf.json` 的 `build.devUrl`（**编译期内嵌的兜底值**，正常启动时被注入值覆盖） | `localhost:3100`（兜底值语境）                               |
>
> 所以：**描述 `pnpm dev` 语境的文档必须写解析链端口**（`dev.port.derived`）；
> `localhost:3100` 只在「启动器 / 壳 / 异常兜底」的上下文里才是正确形态。
> `checkVerify` 对二者做互斥核对——某篇文档写了该链路的地址，就必须包含对应 oracle 的值。

| key                 | 文档形态（保留直观值）                  | meaning（可读语义）                                                   | source（权威定义文件）                                                                 | extract                                                                                                                |
| ------------------- | --------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `dev.host`          | `localhost` / `127.0.0.1`               | dev server 监听主机                                                   | `src-tauri/tauri.conf.json` 的 `build.devUrl`；`scripts/dev-launcher.ps1` 的 `-H` 参数 | 从 `devUrl` 的 host 段提取；核对 `dev-launcher.ps1` 用 `127.0.0.1`                                                     |
| `dev.port`          | `:3100`                                 | **静态链**端口：`tauri.conf.json` 的编译期兜底 `devUrl`               | `src-tauri/tauri.conf.json` 的 `build.devUrl`；`scripts/dev-launcher.ps1` 的 `-p` 兜底 | 从 `devUrl` 的 port 段提取；`.env.example` 里**未注释**的 `COMFYAPP_PORT` 若存在则交叉核对（注释行是「示例」，不参与） |
| `dev.port.derived`  | `:3311`（某检出上的推导值示例）         | **解析链**端口：`pnpm dev` / `pnpm start` / Playwright 实际监听的端口 | `scripts/app-port.mjs`（唯一事实源，另有 PowerShell / Python / Rust 三侧同型实现）     | `resolveAppPort(<仓库根>)`——直接复用 Node 侧实现，不在校验脚本里重写算法（第五份实现必然是漂移源）。取值优先级**四侧逐条对齐**（环境变量 `COMFYAPP_PORT` → 检出 `.env` → 路径推导）；Rust 壳侧的唯一出口是 `single_instance::resolve_app_port_for_root()`，`.env` 必须对它可见（见规范 §1.1.1） |
| `dev.port.fallback` | `:3312` `:3313`（= 解析链端口 +1 / +2） | 解析链端口被占时的回落候选                                            | `scripts/dev-launcher.ps1` 的 `$scanPorts = appPort/+1/+2`                             | 由解析链端口推导；Windows 启动器按此顺序试听                                                                           |

### 1.2 唯一的启动入口（Rust 壳 exe）

> **只有一个 exe**：Python 启动器（`start-tauri*.exe`）与它的 `LAUNCHER_NAME`
> 打包链已随 ISSUE #784 整体移除 —— 双击 `{{shell.app.exe}}` 就是完整的启动形态，
> 编排（起 dev server / 端口 / 缓存 / 回收）由壳自己承担
> （`src-tauri/src/shell_launch.rs`）。

### 1.3 Rust 壳目标文件

| key             | placeholder         | meaning（可读语义）                   | source（权威定义文件）                                                             | extract                                                                                                                                                 |
| --------------- | ------------------- | ------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell.app.exe` | `{{shell.app.exe}}` | 编译出的 Tauri 壳 exe（**唯一入口**） | `scripts/dev-launcher.mjs` 的 `defaultShellExe()` 候选路径（「壳在哪」的唯一判据） | 读候选路径里的文件名（Windows 产物 `app.exe`）。**不要**取 `productName`（是 `ComfyAPP`）或 `externalBin`（是 Node sidecar）：两者都不是这个 exe 的名字 |
| `shell.splash`  | `{{shell.splash}}`  | 启动页文件名                          | `src-tauri/tauri.conf.json` 的 `windows[0].url`                                    | 读 `windows[0].url` 值（`splash.html`）                                                                                                                 |

### 1.4 独立单值端口（非 dev 端口族）

> 与 dev 端口的「端口族 + 语义清晰」不同，这类端口是**独立语义**，文档里用语义化占位符
> 替代裸值（与 `shell.*` 类一致），doc:render 替换成真实值。
>
> **MCP 端口约束**：MCP HTTP 服务与 dev server 分属不同用途，端口号必须**避开 dev 回落族**
> （`[COMFYAPP_PORT, +1, +2]`；端口缺省时由检出路径推导，故「默认族」不是固定的 `3100/3101/3102`
> ——那只是兜底），否则脚本（如 `scripts/sync-lint.ps1` 的
> 端口监听检测、doc:check 的 dev 端口族核对）会把 MCP 监听误判成 dev server 实例。因此 MCP
> 默认端口刻意取在 dev 回落族之外，具体值由 `tools/mcp-http.ts` 单一权威定义，可通过环境变量
> `MCP_HTTP_PORT` 覆盖（默认 `4300`）。
>
> **同号与范围限定**：MCP 端口 `4300` 已避开 dev 回落族，ComfyUI 生态端口 `8188` 非本项目
> 单一事实。为明确语义并避免跨文档误判，这二者均用占位符并经 **`onlyDocs` 限定**——仅在该
> 事实声明的文档组内校验，不影响其它文档。`docs/standards/Comfy-APP-T3-项目开发规范.md` 的
> 「开发端口」行是**同一值的第二引用点**，经 `otherDocs` 并入同一事实（而非把它挪出校验范围），
> 故 `comfyui.port` 的校验范围为 `onlyDocs ∪ otherDocs`。

| key             | placeholder         | meaning（可读语义）               | source（权威定义文件）                                | extract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------- | ------------------- | --------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registry.port` | `{{registry.port}}` | shadcn 本地团队 Registry 服务端口 | `tools/scripts/start-registry.ps1` 的 `$Port`         | 读 `$Port` 值（`3874`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `mcp.http.port` | `{{mcp.http.port}}` | Workshop MCP HTTP 服务端口        | `tools/mcp-http.ts` 的 `MCP_HTTP_PORT ?? 4300`        | 读 `MCP_HTTP_PORT` 默认值（`4300`）；仅 `docs/workshop-mcp.md` 校验                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `comfyui.port`  | `{{comfyui.port}}`  | ComfyUI 默认监听端口              | `src/lib/endpoints.ts` 的 `COMFYUI_DEFAULT_PORT` 常量 | 读常量的值（`8188`）；校验范围 = `onlyDocs`（`docs/workshop-mcp.md`）+ `otherDocs`（主规范「开发端口」行）。**权威源换过两次**：#536 P3 之前这个端口散落在 5 个文件里（`client.ts` 只是其中一处），先收敛成 `app-settings.ts` 的常量；#534 P1 再把**定义**搬到零依赖的 `endpoints.ts`（设置页视图也要读它，而 `app-settings.ts` 顶层 `import fs`，浏览器图一 import 就整页 500），`app-settings.ts` 只再导出同名。因此提取规则指向 `endpoints.ts` 的定义处（迁移原因与门禁见规范 launch-and-build §9.2 第 5 条） |

### 1.5 注释语言的「纯 ASCII 模块」白名单（ISSUE #678）

> 注释一律中文（AGENTS 硬规则 23 / 规范 12 §12.4.6），**唯一例外**是「会被
> `next-code-frame` 渲染到」的构建期模块：Next 的 code frame 按**字节**切串，
> 高亮区间端点落在多字节字符内部时 Rust 侧直接 panic，整个 `next build` 被一个
> 与业务无关的错误带走（规范 launch-and-build §5）。因此那几个文件必须保持纯 ASCII，
> 注释写英文，并在文件头注明原因。
>
> **这一行的「模块清单」就是权威定义本身**（没有第二个事实源）：`scripts/doc-facts.cjs`
> 反向解析本行登记的反引号路径，喂给规范 12 §12.4.6 的 ASCII 比例棘轮。
> 名单越短越好 —— 新增一个必须能说出「它为什么会被 code frame 渲染到」。

| key                          | 名单（权威定义）                                                                                                                                                    | meaning（可读语义）                       | source（权威定义文件）     | extract                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------- | ---------------------------------------------------- |
| `comment.language.asciiOnly` | `src/lib/db-schema-ready.ts`（构建期被加载且是报错现场）、`src/server/db.ts`（每条路由的模块图都拉到）、`src/lib/shell/tracing-ignore.ts`（构建期模块图上的纯工具）、`src/lib/sqlite-pragmas.ts`（被 `src/server/db.ts` 拉进每条路由的模块图，与它同一条例外理由） | 注释写英文且源码保持纯 ASCII 的模块白名单 | 本行（清单本身即权威定义） | 解析本行反引号路径；规范 12 §12.4.6 的棘轮读同一结果 |

---

## 2. 路径类引用（文件 / 目录路径）

> 这一类是「文件名 / 路径」本身，出现在文档里是为了让读者知道去哪个文件看。
> 改为占位符反而会**严重伤害可读性**（读者看不懂占位符是哪条路径），且文件
> 重命名/移动属小概率事件。因此**保留原样**，由脚本核对「路径指向的文件确实存在、
> 且位于正确目录」——防止文档写了个不存在的路径（比裸值过期更隐蔽的错误）。
> 新增/移动文件后跑 `pnpm doc:check` 即可发现文档路径失效。

| key                         | 语义                      | 权威路径（应存在）                    | 说明                                                                               |
| --------------------------- | ------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------- |
| `path.tauri.conf`           | Tauri 配置                | `src-tauri/tauri.conf.json`           | 窗口与构建配置                                                                     |
| `path.lib.rs`               | Rust 壳入口               | `src-tauri/src/lib.rs`                | 窗口逻辑 / 端口协调                                                                |
| `path.dev-launcher`         | 启动编排脚本（Windows）   | `scripts/dev-launcher.ps1`            | Windows 侧进程编排者（taskkill / Job Object）                                      |
| `path.dev-launcher.mjs`     | 启动编排脚本（跨平台）    | `scripts/dev-launcher.mjs`            | Linux / macOS 侧进程编排者（进程组 / 会话锚点），与 .ps1 同契约同产物（规范 §3.3） |
| `path.dev-launcher-session` | 启动会话锚点              | `scripts/dev-launcher-session.mjs`    | PID + 心跳落盘，崩溃后仍可回收孤儿                                                 |
| `path.shell-launch-rs`      | 壳自编排模块              | `src-tauri/src/shell_launch.rs`       | 起编排器 / 认亲 / 回收 / 运行模式                                                  |
| `path.start-entry`          | 桌面壳启动入口            | `tools/start/start-tauri.ps1`         | 双击即启动（直启 `app.exe`）                                                       |
| `path.start-entry-dev`      | 壳开发入口（Rust 热重载） | `tools/start/start-tauri-dev.ps1`     | `pnpm tauri dev`                                                                   |
| `path.build-desktop`        | static 组装脚本           | `scripts/build-desktop.mjs`           | 产出 `src-tauri/static`                                                            |
| `path.rebuild-static`       | 重建 static 入口          | `tools/build/rebuild-static.ps1`      | 入口薄壳（逻辑在 tools/scripts/）                                                  |
| `path.build-tauri-release`  | 重编壳 + 打包             | `tools/build/build-tauri-release.ps1` | 重编壳入口                                                                         |
| `path.nvmrc`                | Node 版本                 | `.nvmrc`                              | Node LTS 约定                                                                      |

---

## 3. 校验范围

> `pnpm doc:check` 校验纳入 `SCOPED_DOCS` 的文档集合，现已**全量纳入** `docs/standards/`
> 规范正文（01~17 章）与 `docs/guides/` 规范指南，连同启动链路/含值类文档共 26 篇
> （「全量」由 §3.1 的校验范围守卫机器判定：新增规范文档未登记即报错，不再靠人记得）：
>
> - **启动链路类**：`docs/standards/launch-and-build.md`、`docs/startup-hotreload.md`、
>   `docs/guide-non-developer.md`、`docs/guide-stale-code.md`（与
>   `guide-non-developer.md` 同组：应用内「页面跑着旧代码」的处置指南）
> - **含值类引用的文档**：`docs/standards/Comfy-APP-T3-项目开发规范.md`、
>   `docs/standards/16-shadcn-ui与表单校验.md`、`docs/workshop-mcp.md`
>   （MCP HTTP 端口经 `onlyDocs` 仅在 workshop-mcp 校验；ComfyUI 端口经 `onlyDocs` +
>   `otherDocs` 在 workshop-mcp 与主规范「开发端口」行校验）
> - **standards 规范正文**：`01`~`17` 章其余各篇（含路径/规范描述）
> - **guides 规范指南**：`DEV-QUERIES.md`、`PRODUCTION-GAPS.md`、`TESTING.md`、
>   `sync-after-pull.md`
> - **guides 功能流程图**：`feature-workshop-flow.md`、`feature-workflow-library-flow.md`
>   （与规范同样纳入：图里出现的路径 / 值若与源码脱钩，读者会照着**一张过期的图**
>   把控方向，比没有这张图更糟）
>
> **不纳入**：`docs/audits/`（过程文件）、`docs/api/`（TypeDoc 自动生成）、
> `docs/superpowers/`（设计归档）、`docs/generated/`（本体系自动生成产物）。
> `docs/glossary.md`（术语表）位于 `docs/` 根、不在 `SCOPED_DOC_DIRS` 内：它由**术语 →
> 所指 → 代码落点**的对照表构成，路径以可读的代码落点写法出现（非「存在性引用」），
> 纳入裸值/路径扫描会因表格里的示例标识符误报；如需把其中某个具体路径升级为存在性核对，
> 按第 4 节补登为 `path` 类 FACTS 即可。
> 规范目录（`docs/standards/`、`docs/guides/`）里**不纳入**的只有两条，且都在
> 脚本的豁免名单里**显式声明并附理由**：`docs/standards/README.md`（文档集索引，
> 只有导航与章节映射）、`docs/guides/reviews/2026-08-30-canvasnode-review.md`
> （代码审查归档，历史快照）。
>
> 这些文档以**路径类引用与规范描述**为主，不含值类裸值。值类引用由登记表 FACTS
> 动态核对；关键基础设施路径由第 2 节 path 类 FACTS 核对存在性。文档正文的细粒度
> 路径（如 `src/env.ts`）因大量为**占位、否定性说明、目录约定示例**，不自动扫描，
> 以免误报；如需将某个具体路径纳入存在性核对，按第 4 节把它补登为 `path` 类 FACTS
> 即可。文档删除或新增路径时，同步维护本表与 `docs/README.md` 的文档体系索引。

### 3.1 校验范围守卫（新增文档必须二选一）

> 「全量纳管」此前是人工承诺：`doc:check` 只校验 `SCOPED_DOCS` 里列出的文档，
> **未登记的新文档会被静默跳过**——里面写死过期端口也不会报错。现在由脚本硬性
> 判定，不再依赖人记得登记。

`pnpm doc:check` 会遍历 `docs/standards/` 与 `docs/guides/` 下的每个 `.md`：

| 情形                                                                     | 结果                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------ |
| 在 `SCOPED_DOCS` 里                                                      | 正常参与校验（防裸值 / 核对端口 / 核对路径存在） |
| 在 `SCOPED_DOC_EXEMPTIONS` 里（`scripts/doc-facts.cjs`，**必须附理由**） | 跳过校验                                         |
| 两者都不在                                                               | **报错**，点名文件并提示登记或豁免               |

豁免名单本身也受校验：理由为空、或指向的文件已不存在 → 同样报错，防止名单
变成过期条目的垃圾桶。新增 / 删除 / 重命名规范文档时，按上表二选一即可。

回归测试见 `tests/check-doc-references.test.ts` 的「校验范围守卫」用例组。

## 3.5 编辑文档与生成文档（双文档机制）

> 为解决「占位符读起来不直观、看不到具体数值」，本体系把同一份文档拆成两态：
>
> | 态           | 位置                                                                     | 内容                                               | 维护者                                           |
> | ------------ | ------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------ |
> | **编辑文档** | 上表 SCOPED_DOCS 对应的源文件（如 "docs/standards/launch-and-build.md"） | 用语义化占位符 {{shell.app.exe}} 作单一事实        | 人写，配合 pnpm doc:check 防裸值回潮             |
> | **生成文档** | 运行 pnpm doc:render 输出到 docs/generated/                              | 占位符已替换成从源码提取的**真实值**（如 app.exe） | 脚本自动生成，**禁止手改**；改编辑文档后重新生成 |
>
> - **单一事实**：两态共用同一份 FACTS（scripts/doc-facts.cjs），真实值只从
>   源码/配置动态提取，不存在第二事实。改源码 → 跑 pnpm doc:render → 生成文档自动同步。
> - **生成文档不参与 doc:check**：它含真实裸值，不属于校验范围；校验只针对编辑文档
>   （SCOPED_DOCS），防止编辑态被裸值侵蚀后生成文档误当编辑文档。
> - **何时重新生成**：改动编辑文档或上游源码真实值后，运行 pnpm doc:render 刷新
>   docs/generated/。生成文档随源码一起提交，读者可直接查看原文。
> - **可执行工具**：`tools/docs/generate-docs.ps1` 是傻瓜式入口（双击即跑
>   `doc:check` + `doc:render`），逻辑在 `scripts/generate-docs.ps1`。

## 3.6 AGENTS.md ↔ standards 漂移守卫

> 代理自动加载的唯一导航文件 AGENTS.md 位于仓库根，历史上恰好落在 §3「校验范围
> 守卫」的盲区（`SCOPED_DOCS` 只覆盖 `docs/**` 与 `docs/guides/**`）。守卫由
> `scripts/check-doc-references.cjs` 的 `checkAgentsMdDrift()` 承担，**只挡「找
> 不到 / 拼错」这类确定性缺陷**，不挡「章节存在但内容语义漂移」那种要靠 review
> 的问题。判据分三类：
>
> | 类别               | 判据                                                                                                                                                          | 边界                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
> | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
> | C1 / C3 路径存在性 | AGENTS.md 里**反引号包裹**或 **markdown 链接目标**指向的仓库相对路径必须真实存在（文件或目录）                                                                | 仅当路径以允许前缀（`scripts/`、`src/`、`tests/`、`docs/`、`tools/`、`.githooks/`、`src-tauri/`、`changelog.d/`、`public/`、`e2e/`）开头、或属于允许根配置白名单（`package.json`、`README.md`、`AGENTS.md`、`CHANGELOG.md`、`next.config.js`、`eslint.config.js`、`tsconfig.json`、`vitest.config.ts`、`pnpm-workspace.yaml`、`.env.example`、`.nvmrc`、`.mcp.json`、`db.sqlite`）时才纳入核对。通配 `**`、占位符 `<x>`、range 记法 `01~18`、`§` 章节号、代码符号（`Process.Kill()` / `api.x.y.useQuery/useMutation`）、URL / 锚点、`::1` / IP、配置对（`core.hooksPath=.githooks`）一律视为**非路径形态**、跳过。 |
> | C2 章节锚点        | 3 行窗口内同一 bullet 同时出现 `docs/standards/NN-*.md` 与 `§NN.M`（且 `major == NN`）时，去目标文件里定位 `^#{1,6}\s+(§)?NN.M\b` 标题锚点                    | 单级 `§N`（如 `§17`）不校验，粒度太粗易混淆；`launch-and-build.md` 无 `NN-` 前缀不进入匹配面，避免与 `standards/NN-*` 里同号章节跨文件误配（本仓库 `§9.5` 在 `standards/09` 与 `launch-and-build` 各有一份）。                                                                                                                                                                                                                                                                                                                                                                                                     |
> | C4 台账命令口径    | `checkLedgerCommands` 的遍历集合是 `[AGENTS_MD_PATH, ...SCOPED_DOCS]`，让 AGENTS.md 与 §2「台账命令口径守卫」（防 npm/npx 表述漂移，AGENTS 硬规则 1）同层受控 | AGENTS.md **刻意不进** `SCOPED_DOCS`——进则被 `render-doc-placeholders` 复制成 `docs/generated/AGENTS.md`，产物里没有 {{占位符}} 需要替换、只是同一份内容，反而误导读者去改产物（规范 §13.5.5「禁止手改生成物」）。现有 `checkLedgerCommands` 已带说明性引用豁免（同句出现「改为 / 修正 / pnpm / 禁止 / 违反」放行），无需为本条单开新判据。                                                                                                                                                                                                                                                                        |

守卫**已随 `doc:check` 一起进 `.githooks/pre-commit`**（D 组「文档引用与权威源一致」，
ISSUE #1371 把旧的「手动档」签字翻掉了；改 AGENTS.md 或调整 `docs/standards/**` 章节号后
不必再靠人记得跑 `pnpm doc:check`）。回归测试见 `tests/check-doc-references.test.ts`
「AGENTS.md ↔ standards 漂移守卫」段。

## 3.7 门禁步骤的引用口径：写标签，不写序号（ISSUE #1374）

> 引用 `.githooks/pre-commit` 或平台流水线里的某一步时，规范文档与索引**一律写日志里
> 打印的标签**（`── check: <标签>`）或那一步跑的脚本名，不写「第 N 步」。
> 判据 = `scripts/check-doc-references.cjs` 的 `checkGateStepIndexRefs()`。

**为什么序号不能用**：钩子早已是「组 0 + A/B/C/D 四个并行组」，「第 N 步」在这份形状上
**没有唯一解释**（同一批文档里混着「branch-guard 算第 1 步」与「判据从第 1 条起算」两种口径，
两种口径下各有对不上的），而序号又不属于任何现有事实核 —— 于是每给 D 组追加一步，
文档里那批数字就整体错位一次。**表现不是红，是指到别的判据上**（这比找不到更糟）。
立案时的实测样本：UI 基元复用棘轮的旧序号写作 12 而实际是 D 组第 9 条；生成态文档同步的
旧序号写作 26 而实际第 21 条；另有三处把 **C 组固定清单**里的用例称作「pre-commit 第 23 步」这种序号。

**判据形状**：同一行既要出现 `第 N 步`（含 `第 27/28 步` 这种 range 形态），也要出现
`pre-commit` / `.githooks` / `CI`，才报错。所以 §2.2 那种**过程序号**（它的第 5 步、
`prepare-local-run.ps1` 的第 3 步）不受影响 —— 那种序号正是本条推荐的替代形态之外的正常用法。
豁免与 C4 同族：同行出现「不写 / 别再 / 禁止 / 应写 / 一律 / 改成 / 序号 / 已删 / 历史」等
纠正词，视为在描述这条规则本身。

**刻意不扫的面**：`changelog.d/**` 与 `CHANGELOG.md`。碎片是**当时那次变更的账本**
（AGENTS 硬规则 14 / §13.10.5），里面的序号是历史事实，回头改写等于伪造证据。
这条边界由 `tests/check-doc-references.test.ts` 的「历史碎片不被扫」钉住。
`docs/generated/**` 也不扫 —— 它是产物，改编辑态源文档后由 `pnpm doc:render` 还原。

**标签从哪来**：`grep -n '^  run "' .githooks/pre-commit` 逐字取，或跑一次提交看
`── check:` 那些行；`tests/doc-check-hook-wiring.test.ts` 里的 `dGroupSteps()` 是同一形状的解析器。

## 4. 维护规则

1. **改源码/配置里的真实值**：只改源码那一处，跑 `pnpm doc:check` 由脚本自动
   发现文档未同步处，按提示更新占位符（占位符本身不变，变的是它代表的值）。
2. **新增可复用值**：先在本表加一行 `key / placeholder / source / extract`，
   再在文档用占位符替代裸值。
   同一值在**多篇文档**出现且原文形态不同（如 ComfyUI 端口在 workshop-mcp 里是
   无括号 `:8188`、在主规范里是 `localhost:3100` / `:8188` 并列行）时：
   用 `onlyDocs` 声明主适用文档组 + `otherDocs` 追加其余引用点，**不要把引用点
   挪出校验范围**——挪出去等于放弃防回潮，下次改端口这两处就静默过期。
3. **占位符要可读**：`placeholder` 用语义化命名（如 `{{dev.port}}`、`{{shell.app.exe}}`），
   禁止 `{{x1}}` 这类晦涩代号；表内 `meaning` 列给出人类可读解释。
4. **本表不存值**：禁止在本表硬编码真实值（那是第二事实）。值只在源码，由脚本提取。
   > 例外的边界：§1.1 表格里出现的 `:3100` / `:3311` 是**文档形态示例**（说明「这类值在文档里
   > 长什么样」），核对一律由脚本运行时提取；`dev.port.derived` 的示例值取自某个检出上的运行
   > 结果，换个检出就是别的数字——这正是它必须由脚本提取、不能写死的原因。
5. **双文档同步**：改了编辑文档或源码真实值后，跑 `pnpm doc:render` 重新生成
   `docs/generated/` 并一并提交，保证读者看到的生成文档是最新原文。
