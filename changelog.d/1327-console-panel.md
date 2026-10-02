## Added

- **应用内控制台**（ISSUE #1327）：左侧栏新增「控制台」入口（全局浮层，与「模型适配 / 模式契约」并列），点开是一块全屏视图 —— 跑质量门禁、推 schema、查 git 历史这类**本来要另开一个终端窗口**的操作，现在在应用里就能做。
  - 形态：左栏常用命令（点一下把命令**填进输入框**、不直接跑，用户还能改参数）；中间输出区（贴底跟随，跑完给一条成功 / 失败 / 已停止的结论条）；底部输入行（回车执行、跑的过程中可停止、可清屏）；跑过的命令留在 chip 里可再填回。输入框的 Enter 判据走 `ui/use-enter-commit`（一并处理输入法组字中的 Enter），事件取值走 `~/lib/form-props`，输出区的贴底走 `ui/use-scroll-follow` —— 都是既有出口，不新写第五份。
  - **输入框不是 shell**：一行拆成「可执行文件 + 参数数组」后直接 `spawn`，不经过 `cmd.exe` / `sh`（支持引号与反斜杠转义空格；`;` `|` `>` `&&` `$(…)` `%VAR%` 都只是普通字符）。理由写在 `src/lib/console/console-catalog.ts` 文件头：两套平台 shell 的解析规则不同（`cmd` 认 `%VAR%`、`sh` 认 `$VAR`、`^` 转义只有 cmd 有），同一行会跑出不同的东西，而界面只能有一份回显。
  - 配套给出**可见的提示**（`shellSyntaxWarning`）：端到端实测过 `node -v && pnpm -v` 会变成「`node` 带上 `-v` `&&` `pnpm` `-v` 四个参数」，而 node 静默忽略多余参数、**退出码 0** —— 界面上看起来一切正常，用户以为跑过了两条命令。所以提交前在输入框下方点名命中的字符、说明「不经过 shell」，而不是等用户自己发现结果不对。判据是提示不是拒绝（`echo "a|b"`、`git log --format=%H` 是正当用法，不该被挡）。
  - **单槽 + 整树回收**（硬规则 3）：同一时刻只允许一条命令，忙时 409 拒绝并回「哪条在跑、跑了多久」（不排队 —— 排队会让人以为点了没反应）。停止 / 关闭面板 / 切走视图 / 看门狗到点都走 `killProcessTree`：`pnpm test` 起的 vitest fork、`drizzle-kit studio` 起的服务一并收走，不留孤儿占端口与日志文件。`cancel()` 里用 `cancelOnClose` 区分「我们主动关流」与「用户断开」，避免对已退出的 pid 再杀一次（pid 复用时会杀错）。
  - **安全边界是「谁能到达」，不是「命令里的词」**：三道闸按序 —— ① 回环检查（`console-guard.ts`：`Host` 与 `Origin` 都必须是回环，否则 403；判据覆盖 `localhost` / `127.0.0.0/8` / `::1` / `::ffff:127.0.0.1`，且 `127.evil.com` 这类近似串判否）② 会话（与其余 REST 面同一条 `requireRequestUser`，未登录走同一个 401 信封）③ 入参形态（512 字符上限 + 解析）。**刻意不做危险命令黑名单**：它拦不住 `node -e "…"`，却会让读到它的人以为拦得住（§12.18 点名过的「会静默失效的清单」）。反代场景的已知边界（`Host` / `Origin` 可被伪造）写进指南，不当成漏洞藏起来。
  - 预算：输出转发上限 20 万字符、单条命令上限 10 分钟。撞上时**停发但仍让命令跑完**（结论比日志重要），并在输出流里补一句用户看得见的说明 —— 「日志到顶了」与「命令卡住了」对用户是两件事，必须分得开。
  - 运行槽挂在 `globalThis`（键名带版本号）：Next 的热编译会把 route 模块重新求值，模块级单例会出现「旧实例的命令还占着槽、新实例看不见」，用户看到的是「没有命令在跑但点了没反应」，再点一次就有两条 `pnpm test` 抢同一批资源。
  - 路由日志走 `~/lib/core/logger`（连带拿到脱敏与 ERROR 镜像），不直接 `console`。

## Docs

- 新增 `docs/guide-console.md`：怎么用 / 预设覆盖什么 / 输入框的边界（不是 shell，附实测现象）/ 三道闸与本机边界（含反代那条已知取舍）/ 单条命令在跑时的回收语义与两个预算 / 排障表。`docs/README.md` 索引已挂点。

## Tests

- `src/lib/console/console-catalog.test.ts`（20 条）：解析器的引号 / 转义 / 空引号 / 控制符当普通字符 / 空命令 / 引号未闭合；预设 id 全局唯一、都能被解析器拆开、只走 `pnpm`/`node`/`git` 且不用 npx（硬规则 1）、指向的脚本真实存在于 `package.json`、**不含 shell 控制符**；`shellSyntaxWarning` 逐类控制符、`git log --format=%H` 不误报、普通命令不误报、同一片段只点名一次。
- `src/lib/console/console-guard.test.ts`（9 条）：回环的四种写法与 IPv6 映射形态、`127.evil.com` 这类近似串不得判成回环、`Origin` 缺失放行 / 指向外部拒、`Host` 缺失判否（拿不到判据时不判放行）、`Origin` 不可解析判否。
- `src/lib/console/console-run.test.ts`（11 条，起**真进程**）：start / out / exit 帧与实际 argv、中文输出不乱码、非零退出码透出、`busy()` 的生命周期、取消标 `killed` 而不是伪装成失败、**孙进程也被收走**（硬规则 3 的回归判据）、输出上限的两条分支（恰好填满 / 填满后还有迟到输出）、看门狗到点、可执行文件不存在时给 `error` 帧。
- `src/lib/console/console-client.test.ts`（17 条）：四种帧的窄化与错型兜底、SSE 按 `\n\n` 切帧且**半个帧必须续接下一次**（丢了就是「最后一行神秘消失」）、一次 chunk 里多帧按序回调、畸形帧不影响后续帧、非 2xx 走服务端信封文案、非 JSON 失败体给可读文案、正常流最后 flush 掉不完整帧、中止 → `aborted`（不是 `failed`）、断流 → `failed`、响应无 body → `failed`。
- `src/lib/console/console-registry.test.ts`（3 条）：同进程内是同一个槽、重置后互不可见、历史超上限丢最旧的。
- `src/lib/console/console-route-gates.test.ts`（7 条，源形态）：三道闸的**存在与次序**（回环在鉴权之前、鉴权在读体之前、长度在解析之前）、409 在起进程之前、断开回收与 `cancelOnClose`、SSE 头写全（含 `X-Accel-Buffering`）、预算常量只有一处出处（路由里不得出现裸数字上限）。删掉回环检查不会有任何运行时用例变红 —— 这条只能靠它。

## Gates

- `src/lib/console/**` 新域登记进 `scripts/check-file-structure.cjs` 的 `DOMAINS`（R14），并在 `vitest.config.ts` 按**实测值**设门槛 95/95/95/85（§18.6，只升不降；每条与实测的差都写在注释里）。
- `src/lib/console/console-run.ts` 按 §18.4 第三类登记进 `PURE_NODE_HOSTS`（顶层 `child_process`；回收走同属第三类的 `kill-process-tree`），登记项由用例反向核对仍然成立（清单只许变短）。
- 端到端实测（真起 dev server + curl）：`git status -sb` 逐帧回 SSE 并以 `code:0` 收口；非回环 `Host` / 跨源 `Origin` → 403；空命令 / 引号未闭合 → 400；第二条命令在跑时 → 409 且文案带「已跑 Ns」。
