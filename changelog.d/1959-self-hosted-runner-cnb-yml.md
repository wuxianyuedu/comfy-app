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

- **`.cnb.yml` 的「工具链自证」补 Python，且探测面与门禁同口径**：Python 是门禁链的
  真实依赖（`check-app-port-vectors.cjs` 要跑 `.py` 做四语言比对、几处用例用它验 zip
  包），而缺了它的表现是**静默少判**而不是报错。第二轮首跑又照出：原先写的是裸的一行
  `python -V`，只在宿主机恰好有这个裸名时才过，而这台机器上 `python3` / `python` 都
  没有 —— 于是第 8 秒就在这一步红掉、排在后面的 27 个 stage 一个都没跑。现在依次试
  `python3` / `python` / `py`（Windows 上 `py` 带 `-3`），并让失败分支**打印下一动作**
  （`CommandNotFoundException` 分不出「装了但没进 PATH」与「没装」，而处置不同）。
- **`.cnb.yml` 的工具链自证**找不到解释器时先**尝试当场装**：`winget` 常年在盘上却不在
  构建会话的 PATH 上（`WindowsApps` 那条按用户追加的路径要新会话才生效），所以除了
  `Get-Command` 还按标准落点 `%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe` 再找一遍，
  找到就 `--scope user` 装（不需要管理员），装完再复验。两处都不在时**仍非零退出**，
  并把它写成**平台侧人工动作**（与「节点标签要对得上 `runner.tags`」同一类）：
  自托管最大的成本是「这台机器要自己维护」，而它不会因为少装了什么就报错 ——
  这一步就是那个「会说话」的地方。
- **脚本按 Windows PowerShell 5.1 的语法面写**：宿主是节点上的默认 `powershell`，
  而 `?.` / `??` 这类 pwsh 7 才有的语法会让**整段当场报错**（实测：按标准落点找
  `winget` 的那一版写成 `(Get-Command winget …)?.Source`，报错「表达式或语句中包含
  意外的标记」指向 `?.Source` 那一行；本机 Linux 侧无从发现）。规范 §13.5.3.5 记下
  这条自查面：要判空就显式 `if ($x) { … }`。
- **`check-app-port-vectors.cjs` 的 Python 候选补上 Windows `py` 启动器**：原来只探
  `python3` / `python`，宿主只有官方 `py` 时这一侧落进 `missing` 档、以「探测不到
  Python」的名义退出四向比对 —— 与 `e2e/support/fake-comfyui-executor-env.mjs` 的
  `pythonCandidates()`（`win32: ["python", "py", "python3"]`）口径不一致。
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
