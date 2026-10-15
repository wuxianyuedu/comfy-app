## Added

- **平台侧流水线随自托管节点重新启用（`.cnb.yml` 回来了）**：根组织接入了自托管
  Windows 构建节点（标签 `win`），而官方文档写明自定义 Runner「构建脚本直接运行在
  宿主机上……`runner.cpus` 配置无效，**不参与核时计费**」——#623 那条「160 核时/月
  用不起」的全部推理都建立在计费上，前提没了，结论随之反转。挂在 `pull_request`
  （全套门禁）与 `push`（master 合并形态复核）两个事件上。

  **反转的是一整套取舍，不是贴一段 yaml**，与本配置同批落地的还有四条：

  1. **形态有了判据**：`tests/no-platform-ci-config.test.ts` 从「仓库根不许有 CI 配置」
     翻成「**要么没有，要么必须是自托管 + 已登记的那一份**」——顶层必须是
     `分支: { 事件: [流水线] }`（#1229 那份顶层直接写 `stages:` 的配置从不触发、
     静默失效），必须有 `runner.namespace: group` 与非空 `tags`（漏掉会静默回落到
     **计费的**平台池），必须挂 `pull_request` 与 `push`；`scripts/doc-facts.cjs`
     把 `.cnb.yml` 登记回 path 类事实，规范锚点句同步改写。判据没撤，换了个方向。
  2. **与旧的 Linux 平台池配置是两套形态**：自托管**没有 docker**
     （`pipeline.docker.image` 不生效），所以工具链必须预装在宿主机上——配置第一步
     是「工具链自证」（`cmd /c ver` + git/node/pnpm 版本），把「环境该有什么」从注释
     变成会红的断言；脚本语言是 **PowerShell** 而不是 POSIX sh；不声明 `runner.cpus`
     （无效）；不走上报插件那条路（宿主机上不生效）。
  3. **代价换了个位置**：节点离线 / 被禁用 / 达上限时平台**会自动改派**，而这一档的
     「其他节点」就是计费平台池——**最坏情况是悄悄花回核时且不报错**。所以 `push` 侧
     仍然只留一条合并形态复核、不重跑全套，理由从「省额度」变成「省一遍没有新信息的
     运行」；诊断出口（看构建列表标签、看第一步输出）写进规范 §13.5.3.3。
  4. **本地那一层一条都不减**：平台侧取自源分支（「不可信事件」）且跑的是**另一份清单**
     （全量档 + 核心档，钩子走 `--staged` 增量），因此本地钩子与 §13.5.4 的按需召唤
     照旧——平台侧回来不取消它们，正如按需召唤也替代不了平台侧。

## Fixed

- **夹具的 `git commit` 挡不住宿主全局签名 → `git` 的失败消息被吞掉**（8 例：
  `merged-side-loss-gate`）。两件同批：
  ① 构建机全局 `.gitconfig` 带着 `commit.gpgsign = true` + 平台专属 `gpg.program`，
  临时仓库里既没有密钥、那个签名器也不在 PATH 上 ⇒ `git commit` 直接失败，报的是
  签名器缺失的标准三联；夹具里只有 `repo.git()` 这条直路没补「禁签名 + 身份」
  （`repo.commit()` 与另外几份用例各用 `-c` 或 `git config` 补过，已经抄出三种写法）。
  修法**不是在每个调用点补一遍**，而是在 `tests/helpers/git-sandbox-env.ts` 用 git 的
  `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` 机制把「禁签名 + 身份」注入**环境** ——
  夹具起的那一次与被测判据脚本内部自己起的那些一起吃，一处生效、无处可漏。
  ② `git()` 此前是 `stdio: "ignore"`，上面那条报错在日志里只剩一句 vitest 的
  「命令失败」，读起来像夹具坏了（首跑时它被登记成「已知开口」，正是因为拿不到那句话）。
  现在把 `stderr` 拼进抛出的消息里 —— 下一台机器上它自己会把话说出来。
- **`python3` 是 POSIX 的名字**（3 例：`log-run-layout` ×2、`logs/diagnostics/route`）：
  Windows 上官方安装器落的是 `python.exe` / `py.exe`，硬编码 `"python3"` 直接
  `spawnSync python3 ENOENT`。新增共享件 `tests/helpers/python-exe.ts` 收口解析
  （**真起一次进程**判「可用」而不是看文件名；`py` 启动器补 `-3`），两处调用点改走它；
  没有解释器时这 3 条与 `e2e-fake-comfyui-executor-env` 的「本机真跑一次」按
  **`env` 档跳过并登记**（与 `check-file-structure.test.ts` 的 `!python` 那一族同处置 ——
  机器缺 Python 是**环境**缺口，本仓的既有口径是「跳过 + 在登记表里看得见」，不是让流水线红）。
  实测：PATH 上没有 Python 时，这三份恰好跳 4 条、其余全绿；有 Python 时 39 条全跑。
- **探针夹具用了 POSIX 才有的形态**（1 例：`app-port-vectors-timeout-classification`
  的 `present-but-nonzero`）：那份夹具写的是带 shebang 的临时脚本，而 Windows 的
  `CreateProcess` 不认 shebang（无扩展名文件被当作 `…​.exe` 去找 ⇒ ENOENT ⇒ 判
  `missing`），红的形状与「判据写坏了」逐字同形。改用它自己跑测试的那个 Node
  （`process.execPath` + `-e process.exit(3)`），**两个平台同形、这一格不再 skip**；
  同组「没有执行位 ⇒ missing」那条是真正的 POSIX 语义（Windows 没有执行位），
  补 `needsPosixExec` 别名并经 `tests/conditional-skip-registry.test.ts` 登记
  （档位 `platform`，计数 2 → 1）。
- **平台侧并发超订**（其余 10 例：`base-check` / `deps-freshness-gate` /
  `affected-tests` / `docs-candidate-hygiene` / `premerge-push-trigger` /
  `quality-gate-ps-precheck` 的 30s / 45s 超时）：16 逻辑核的整机 + `--coverage` 的
  插桩 + 大量真起子进程的用例叠在一起，正是规范 §11.13 量过的那一格
  （`Test timed out`，隔离重跑全绿）。**杠杆是并发不是预算**，所以「单元测试」一步
  显式 `--maxWorkers=4`（与钩子 C 组同一个数、同一条理由），用例与预算一字不动。

## Changed

- **Python 解释器的候选表收成一处事实源**（`src/lib/process/python-candidates.ts`）。
  同一件事此前有**四份**写法在漂：门禁脚本、`.cnb.yml` 的就地 PowerShell、e2e 假
  comfy-cli 夹具、`tests/helpers/python-exe.ts`。第二轮首跑之所以「红在第一步、红得
  与『压根没装』逐字同形」，根因就是这一格 —— 流水线探的面与门禁探的面不是同一份。
  现在候选名 / 顺序 / `py` 要带 `-3` 都只定义一次，其余各处以它为准（`resolvePython()`
  连同「真起一次确认」一起收在 `src/lib/process/python-resolve.ts`）；跨 `.cjs` 与
  「刻意不 import」的纯 Node 宿主那两处保留文本副本，由用例逐项对账，漂了就红。
- **流水线的「工具链自证」从就地 PowerShell 收成 `scripts/ci-toolchain-selfcheck.mjs`**。
  那一段此前长在 `.cnb.yml` 里（探 Python、`winget` 当场装、打印「这个账号看得见
  什么」的取证），而**配置里的逻辑一条判据都测不到它** —— `.cnb.yml` 只在平台上跑，
  本地一个执行者都没有，于是它只能靠「推上去看看红不红」验，第二、三轮各红过一次。
  收进脚本之后：候选表回到唯一一处；这一步**能被单测直接跑**；失败时的取证（执行
  账号 / PATH / 安装位置的命中）一并搬进来，并据此给出「位置命中而命令探不到 ⇒
  改这个账号 PATH，**别重复装**；位置也没命中 ⇒ 才是真没装」这条分岔。判的是
  git / node（含 `engines.node` 的 caret **上界**）/ pnpm / Python 四件。
- **取证落点按「这台机的实际布局」问，不按「我们指望它装在哪」问**（紧接着的一跑
  当场订正了一个反方向的猜测）：最初只查标准落点（`%LOCALAPPDATA%\Programs\Python`
  一族），读数是一族**零命中** ⇒ 会得出「这台机真的没装」；可同一份日志的 PATH 里
  明明带着 `D:\Users\yuedu\...` 与 `D:\Program Files\...` —— 这台机把用户数据与
  程序放在 `D:` 盘，解释器根本不在标准落点上。**只查标准落点会反向误导。** 现在
  `scripts/ci-toolchain-selfcheck.mjs` 的落点清单**一处定义、三处用**（取证 / 装后回找 /
  安装），扩成三类：**标准落点** + **本机 PATH 上出现过的盘符下的同类位置**（从 PATH
  反推盘符，不写死 `C:` / `D:`）+ **其他账号 profile 里的按用户安装**
  （`<盘>:\Users\*\AppData\Local\Programs\Python`）—— 最后一类正是「`yuedu` 会话
  答得出来、`NT AUTHORITY\SYSTEM` 构建账号答不出来」的那一格，也就是最初的症状。
  两处顺带收口的形态：探盘符**不按 `path.delimiter` 切**（它是宿主的分隔符，开发机上
  是 `:`，而盘符自带 `:` —— 切完盘符一个都认不出来），改在整串 PATH 上直接匹配；
  注入的 `listDirs` 一路传进落点清单，否则单测里那段 profile 展开会走真 `fs`（在
  Linux 上恒空），判据看着绿、实际没测到。
- **`.cnb.yml` 的工具链自证**找不到解释器时先**尝试当场装**：`winget` 常年在盘上却不在
  构建会话的 PATH 上（`WindowsApps` 那条按用户追加的路径要新会话才生效），所以除了
  `Get-Command` 还按标准落点 `%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe` 再找一遍，
  找到就 `--scope user` 装（不需要管理员），装完再复验。两处都不在时**仍非零退出**，
  并把它写成**平台侧人工动作**（与「节点标签要对得上 `runner.tags`」同一类）：
  自托管最大的成本是「这台机器要自己维护」，而它不会因为少装了什么就报错 ——
  这一步就是那个「会说话」的地方。**实测这台节点上探测不到任何解释器**（`python3` /
  `python` / `py` 一个不见，`winget` 连标准落点 `%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe`
  也不在）—— 所以本 PR 合并前需要一次平台侧动作，而具体是「装」还是「改 PATH」由下面
  那份取证决定。这一步仍按「缺件即非零退出」收：缺 Python 时 E2E `@critical` 的主链路
  必然起不来，与其让它 40 分钟后以几条看不懂的失败回来说，不如在第一步三秒说清，
  并在话术里点名「本次因此少判了哪几条」。

- **脚本按 Windows PowerShell 5.1 的语法面写**：宿主是节点上的默认 `powershell`，
  而 `?.` / `??` 这类 pwsh 7 才有的语法会让**整段当场报错**（实测：按标准落点找
  `winget` 的那一版写成 `(Get-Command winget …)?.Source`，报错「表达式或语句中包含
  意外的标记」指向 `?.Source` 那一行；本机 Linux 侧无从发现）。规范 §13.5.3.5 记下
  这条自查面：要判空就显式 `if ($x) { … }`。

  **「自查」这件事现在有执行者，不再只靠人记得**（本地通常只有 `pwsh` 7，同一行在
  那边完全正常 —— 「我这儿跑得通」在这条上不构成证据）：
  `tests/no-platform-ci-config.test.ts` 的 `ps7OnlySyntaxIn()` 按行扫 `.cnb.yml` 的
  `script: |` 块（按缩进收口，块外的同形文本不算；先剥行内注释），命中
  `?.` / `??` / `::new(` / `-AsHashtable` 即红并**点名行号与替代写法**。
  「不许空转」那组自证同时钉住两端：真语法要红（已用原始 bug 反向复算，报的正是那一行）、
  **注释里**的同形文本要放过 —— 配置里那条 ⚠️ 说明正当地会写出 `?.`，把说明判成
  违规等于逼人删注释。

  > 本笔之后这条判据的射程**变小了**：`.cnb.yml` 里那段就地 PowerShell 已整体搬进
  > `scripts/ci-toolchain-selfcheck.mjs`（Node 侧，本地能跑、能被单测跑），配置里剩下的
  > PowerShell 只有 `pnpm install` 那几行。判据留着 —— 它守的是「**配置里**别写 5.1
  > 解析不了的语法」这件事本身，而那几行以后也可能长。
- **「工具链自证」的判据是 `engines.node` 的闭区间**：`^22.22.2 || ^24.15.0 || >=26.0.0`
  的上界是要紧的，只比下界会放过 `24.14.9` 这类版本 —— 而那正是「不报错、只让某几条
  用例以奇怪方式红」的形态。边界与 `package.json` 由用例对账。
- **`check-app-port-vectors.cjs` 的 Python 候选表改从共享件对账**：原来只探
  `python3` / `python`，宿主只有官方 `py` 时这一侧落进 `missing` 档、以「探测不到
  Python」的名义退出四向比对。现在它的候选与 `src/lib/process/python-candidates.ts`
  同口径，`py` 带 `-3`，两份文本由用例逐项对账。
- **`.cnb.yml` 的门禁清单注释不再指向已删文件**：它还在说要
  `tests/cnb-pipeline-gates.test.ts` 逐条核对，而那份文件随旧版配置一起删于 #623，
  本 PR 不复活它（它锁的是旧版那三十步与上报插件，两样在自托管上都不成立）——
  就地改成如实说明「哪一条判据真的捧着这份文件、哪一件它判不了」。

- **`.cnb.yml` 的 Python 失败分支补上取证（第三轮：人机读数相反时的判读）**：
  同一台构建机上，人在**自己的会话**里 `python -V` 答 **Python 3.12.2**，而构建步骤
  报「`python3` / `python` / `py` 一个都没有」。两者不矛盾，是**执行身份不同** ——
  自托管 Runner 以服务 / 代理账号跑、用的是**机器 PATH**，而 python.org 安装包的默认
  选项「Install for me only」只写进**安装者那个用户的** PATH。这两种情形在日志里逐字
  同形（都是 `CommandNotFoundException`），处置却相反（改这个账号的 PATH / 机器级
  重装 vs 去装一个），此前只能靠猜（winget 那条自动装也是拿它当「真没装」处理的）。
  现在失败分支连**执行账号名、PATH 逐条、四个常见安装位置的命中情况**一起打印 ——
  取证不需要有人远程登进那台机器，下一跑自己会说。规范 §13.5.3.5 跟着补上这条判读
  顺序：**位置命中而探测不到命令 ⇒ 装过、只是这个账号看不见（改 PATH，别重复装）**；
  位置也没命中 ⇒ 这台机真的没装。

