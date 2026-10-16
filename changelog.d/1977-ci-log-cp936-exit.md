## Fixed

- **平台侧日志的中文乱码：把「子进程那一跳」按 CP936 出口，而不是继续钉控制台设置**
  （ISSUE #1977，用户截图那一行是 `Python 探针读数` 的 `ok  python --version  →  …`）。

  ## 一、为什么不是「再钉一次控制台编码」

  #1959 起每个 stage 都以 `$enc=[Text.Encoding]::UTF8; [Console]::OutputEncoding=$enc;`
  开头（`scripts/ci-console-encoding.mjs`），而乱码一个字没少。三轮读数把机器侧的两个
  嫌疑人**依次否掉**：控制台输出代码页 936 → 65001（探针三行逐字未变）、宿主 ANSI
  代码页也换成 UTF-8 并重启过（探针四行仍然逐字未变）。同一份日志里还有一组硬对照：

  - **runner 自己打的行**（`script` 原文回显）**是完好中文**；
  - **子进程输出的每一行**都是「UTF-8 字节按 CP936 解」。

  ⇒ 解码发生在**子进程输出那一跳**，用的是**不与宿主设置联动的 CP936**。
  仓侧只剩一条路：**让每个字节以 CP936 出口**。

  ## 二、出口怎么走：`scripts/ci-cp936-exit.mjs`

  新增一个**一层包壳**：起那条命令、把它的输出交给 PowerShell 以 936 重发、再把它
  的退出码原样转出去。

      node scripts/ci-cp936-exit.mjs -- <命令> [参数...]

  三个要点都不是风格：

  - **顺序是两段，不是一段**：PowerShell 先按 **UTF-8 读对**子进程的输出（这一半由已
    钉的 65001 保证），再按 **CP936 写回**。直接 `chcp 936` 会先毁掉解码 —— 拿到的
    已经是乱码串，再转一次只是把乱码换个编码存下来（规范 §13.5.3.5 那句话）；
  - **转码必须借 PowerShell**：实测 `new TextEncoder("gbk")` 不抛错但**静默落到
    UTF-8**，Node 侧编码不出 GBK 字节；而 `TextDecoder("gbk")` 是好的（带全 ICU）——
    所以「借 PS 编码、用 Node 复核」是这条链能同时成立与被判的原因；
  - **退出码必须转出去**：外壳吞退出码是本仓踩过的坑
    （`ci-toolchain-selfcheck.mjs` 的 `main()` 返回值被丢，那两步从来红不了）；
  - **可执行形态走仓里那一份判据**：本外壳是「包着别的命令起进程」的那一层，而
    Windows 上 `pnpm` 是 `.cmd` / `.ps1` 垫片 —— Node 直接 `spawn("pnpm")` 给
    `EINVAL`。§2.1.1 已经为此收了口（`commandInvocation`），所以这里**必须**过它，
    而不是自己写「Windows 用 pnpm.cmd」（那是第四次踩同一个坑）。

  ## 三、刻意做的边界
  - **非 Windows 直通**：CP936 是中文 Windows 的事，别处没有这一跳；
  - **转码失败不假报成功**：PowerShell 起不来时原文照打并说明「日志可能仍是乱码」，
    退出码仍是子进程的 —— 转码是外壳，它不是判据；
  - **不做第二份「有没有乱码」的判据**：抓取端怎么解码本进程看不到，能判的只有
    「字节是 936 编出来的」（`encodeCp936Plan()`）与「退出码转出去了」。

  用例在 `tests/ci-cp936-exit.test.ts`（22 条，含**反算**：Node 的 `TextDecoder("gbk")`
  解 936 字节回到原文，而同一批字节不转码时正好解出截图里那种 `鈫` 形态）。
  口径、三轮读数、以及「这个外壳自己第一次上平台炸的那两处」在规范 §13.5.3.5 最后两节。

  ## 三之二、第一次上平台：这条路自己先炸了两处（**本地全绿**）

  外壳落地后平台侧 `工具链自证` 直接红，报的是本文件里的一处**只在 Windows 分支里**、
  因而 Linux 检出一辈子执行不到的语句：

      TypeError [ERR_UNKNOWN_ENCODING]: Unknown encoding: buffer
          at Buffer.from (node:buffer:339:12)
          at spawnSync (node:child_process:916:29)

  `spawnSync` 的 `encoding` 要的是**编码名字符串**（或 `null` = 要 Buffer），
  `"buffer"` 不是编码名。**被拒之后自然会改成 `Buffer`，同样被拒** —— 它与字符串
  一样进 `Buffer.isEncoding` 查表，查不到就在 `Buffer.from(input, encoding)` 那里抛。
  要 Buffer 输出的唯一写法是 `encoding: null`。两处都已在用例里反向复算
  （`Buffer.isEncoding("buffer")` / `(Buffer)` 均为 false，且两条在真 `spawnSync`
  上**都**炸 —— 探针必须真的打一行字，`-e "0"` 是炸不出来的）。

  同一次把这条链上**第二个同类隐患**一并收掉：抓子进程输出那一跳写的是
  `String(d)`（`d` 是 `Buffer`），而 `buf.toString()` 的默认编码取自
  `process.stdout` 的 `writableEncoding` —— **在 Windows 上那是宿主代码页
  （CP936）**。转码链是「先解对、再编回」两段，这里断的是**第一段**：子进程的 UTF-8
  字节在**进 PowerShell 之前**就已经被解错，后面按 936 编回去只是把乱码换个编码存下来。
  Linux 的 `process.stdout` 是 UTF-8，**这个 bug 在本机永远不会显形**，所以现在显式
  `setEncoding("utf8")`，判据钉在「两条流各以 `utf8` 钉过一次」这个形状上。

  第三处是**本地就能踩到、但只在某种调用形态下踩到**的：`runWithCp936Exit` 的
  production 解析口 `resolve` 的默认值是 `undefined`，靠 `?? commandInvocation`
  回退；而 Promise executor 的形参**也叫 `resolve`**。一旦取默认值那一句落进
  executor 里，它就是**恒真的 Promise resolve 函数**，回退整段消失、
  `spawn(undefined, …)` 当场抛。现在走模块级别名 `resolveCommandInvocation`，
  并校验解析口交出的形状（报错点不再离真因一整层）。

  ## 三之四、第四次：解析口选错一层，「回退」把裸名字交给了 `spawn`

  修掉上面几条之后 `工具链自证` 转绿（**中文日志已经可读** —— CP936 出口那一步成立），
  红的位置往下走到 `Install dependencies`：

      [cp936-exit] 起不了这条命令：pnpm

  `.cnb.yml` 那一行包的是**一个名字**（`-- pnpm install --frozen-lockfile`），而外壳用的
  是 `commandInvocation()` —— 那一层的契约是「**候选路径** → spawn 形态」，解析不出来时
  **原样退回候选**。对盘上的一条路径那是忠实的，对 `pnpm` 这种名字却等于把
  `spawn("pnpm")` 扔给 Windows（`ENOENT`）。**「回退」在这里不是保守，是把判据的对象
  换成了注定失败的那一个。**

  改用同文件的兄弟 `resolveCommandInvocation()`：收**名字**、交
  `{command, args, resolved}`，并用 `resolved: false` 把「PATH 上查无此命令」变成
  **可读出口 + 127**（一条进程都不起），而不是丢一句信息量很低的 ENOENT。

  实测对照（假 PATH + corepack 三形态 + `EACCES` 判无扩展名 shim）：
  `commandInvocation` 回 `"pnpm"`（裸名字，必 ENOENT），
  `resolveCommandInvocation` 回一个真路径。这也是「本地绿不是证据」的第二个样本 ——
  Linux 上两条解析口结论一样，差别只在 Windows 的候选表上显形。

  ## 三之五、第五处：同一处理但**对象有两类** —— 路径不该拿去问 PATH

  `Install dependencies` 转绿后，红走到 `类型检查`：

      [cp936-exit] PATH 上找不到这条命令：node_modules/.bin/tsc

  `resolveCommandInvocation()` 是**纯 PATH 查找**，而 `.cnb.yml` 的 stage 里
  **两种都真实存在**：`node_modules/.bin/tsc` / `scripts/check-*.cjs` 是**路径**，
  `pnpm` / `node` 是**名字**。对一条相对路径，PATH 查找当然答 `resolved: false` ——
  那不是「找不到」，是**这条不该问 PATH**。把两者混作一谈，上一处刚补的
  「查无此命令即拒」就把**该保守的方向用反了**（判据从「不许把裸名字丢给 spawn」
  退化成「不许用路径」）。

  修法（**两半**，缺一不可）：外壳自己判「路径 or 名字」（含 `/` 或 `\` 即路径，
  **不判它存不存在**），然后按对象分派 ——

  - **名字** → PATH 查找 + 形态（`resolveCommandInvocation()`）；
  - **路径** → **不查 PATH**，但仍要**过分态判据**（`commandInvocation()`）：先
    `path.resolve` 绝对化，再由它把同目录的 `.ps1` 回退找出来。

  ⚠️ 第二半不是可有可无的锦上添花：只做第一半（「路径原样交给 `spawn`」）只解决了
  **误报**，命令在 Windows 上**照样起不来** —— pnpm 给 `node_modules/.bin/<工具>`
  摆的三个垫片（`.cmd` / `.ps1` / 无扩展名 shim），Node 一个都起不了（`.cmd` 只有
  cmd.exe 解释、shim 是 shebang），而这三个是 `.cnb.yml` 里 `node_modules/.bin/tsc`
  与三条 `vitest` 真实要用的形态。**「不问 PATH」回答的是「该问谁」，「过形态判据」
  回答的是「怎么起」—— 两个问题。**

  与上一处合起来是同一句话的两面：**「回退」与「拒绝」都要先认清对象是谁。**

  ## 三之六、第六处（判据的边界）：**注入面能盖住「实现写错了」，盖不住「接错线了」**

  前五处都是「实现写错了」，而判「解析口改对了」的那些用例**全都注入 `resolve`** ——
  注入面是个「输入什么就交回什么」的假实现，于是下面三类错法在它下面**全部看不出来**：

  - **接错线了**（默认值写错、或压根没接上）；
  - **只覆盖了一半形状**（第五处的路径那一半——上一处的用例全用裸名字当输入）。

  所以新增的判据里有两条**不注入 `resolve`**，判的就是那两件注入面看不见的事：
  「默认解析口真的接在编排上」（反向复算：换回裸名字透传，当场报
  `expected [ 'pnpm' ] to deeply equal [ '/tmp/…/pnpm' ]`）与「路径真的过分态判据」
  （反向复算：退回「原样透传」，两条当场点名）。用例 25 → 27 条。

  一句话：**注入面能盖住「实现写错了」，盖不住「接错线了」与「只覆盖了一半形状」。**

  ## 三之三、这三条判据的**边界**

  · **判不到**「平台侧读出来可不可读」—— 解码在本进程之外；
  · **判得到**的因此是「字节对不对」与「编排对不对」，两者都靠**形状 + 真跑一次**
    落地：`String(d)` / `encoding: "buffer"` 这两处在 Linux 上执行不到，所以
    `writeCp936` 开了第三个注入面 `spawnImpl`（前两个是 `platform` / `run`），
    让「真实现起的是什么、传了什么值」在本地就能判；

  ## 四、顺带修掉一条**已空转的判据**（它的绿不是「判过了」）

  `tests/ci-toolchain-selfcheck.test.ts` 的「`--playwright-only` 判不过时退出码是 1」
  用**按源码原文 `String.replace` 打补丁**的方式造现场，而那份源码会变：`install`
  那处在 `runPlaywrightInstall({` 多行化之后就没再匹配上（`replace` 不匹配时**静默
  no-op**）。剩下的两处补丁指不回**自取成功那条早退**（它也按**真落点**判），于是
  在**预装了那件浏览器的机器上**（本仓 Linux 检出、自托管节点都算）自取一「成」就
  当场 `return 0` —— 这一条不再判「退出码转没转出去」，退化成「这台机器装没装浏览器」，
  而它**照样绿**。CI 上之所以没露出来，只是因为那台节点没预装。

  修法两步：补上第三处补丁（那条早退），并加一条**反向复算** —— 三处补丁各自判一次
  「真的落到盘上了吗」，缺一即红（已按「把补丁摘掉」复算过，当场点名）。
