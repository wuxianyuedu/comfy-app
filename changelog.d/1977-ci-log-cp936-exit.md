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

  ## 三之七、第七处：起不来那条出口**没有真因**（第四轮的现场）

  第四轮外壳把命令起成了一条**拼错的两段命令**（`npx tsc` 当成一个文件名），平台侧
  只拿到一句：

      [cp936-exit] 起不了这条命令：node_modules/.bin/npx tsc --noEmit

  「两条命令被当成了一条、盘上没有那个文件」这件事，**从这个出口上读不出来**。
  而它本来就不该读不出来 —— 前一处刻意选的方向是「路径不进 PATH 查找，让盘自己回答」，
  于是 `resolved: true` 只表示「调用方写的是路径」，**不表示它在盘上**；「盘说没有」
  这一格的结论全在 `child.on("error")` 的 `err` 上，而那条出口把 `err` 整个丢掉了。

  现在 `formatSpawnFailure()` 把三样东西一起打出来，各自回答一个问题：

  - **`err.code`** —— `ENOENT` 是「盘上没有这件东西」（名字 / 入参对不上），
    `EACCES` / `EINVAL` 是「有，但起不来」（Windows 上那是批处理 / shim 形态，
    处置见 §2.1.1）。两类要做的动作完全不同，压成一句「起不了」就只能靠试；
  - **解析口交回的绝对路径**（只在解析真的发生过时才多打一行）—— 一行
    `module.exports` 的 shim 与真可执行文件，看路径一眼就知道；
  - **当前目录 + 调用方的原文** —— 相对路径是相对**谁**的（stage 的工作目录由平台给，
    本壳看不到），不写出来只能猜。

  判据两条（`tests/ci-cp936-exit.test.ts` 27 条，**三处都反向复算过**：退回旧出口、
  把两类失败码的措辞压成一句、去掉当前目录，各自当场红）：一条判**措辞**（ENOENT 与
  EACCES 的结论必须分开、cwd 要在、没解析时不打「通过解析口起的」），一条判**这条出口
  真的走得到**（起一条不存在的相对路径，断言回 `ENOENT` 与那段原文 —— 这一格在 Linux
  上判得动，错误码与 Windows 上的现场同形）。

  ## 三之八、判据本身的一处**误报**：块注释里的反面举例被读成「真写了这句」

  `tests/dev-launcher-toolchain-gate.test.ts` 那条「由 Node 起 pnpm 一律经形态判据」
  的扫描器只剥 `//` 行注释、**不剥块注释**：

      const code = raw
        .split("\n")
        .map((line) =>
          line.replace(/^\s*\/\/.*$/, "").replace(/([^:])\/\/.*$/, "$1"),
        )
        .join("\n");

  而 `scripts/ci-cp936-exit.mjs` 的头注（`/** … */`）里正好拿 `spawn("pnpm")` 当**反面
  举例** —— 块注释的每一行都以 `*` 起头，上面的剥法一条都匹配不上，于是判据把一个
  注释里的引文读成「这个文件真写了这句」，点名 `scripts/ci-cp936-exit.mjs: 直接起 pnpm`。

  这一条此前一直没露出来，有两个各自独立的原因：平台侧停在 `类型检查` 前面几步；
  而 `scripts/base-check/hook-steps.mjs` 里同形态的引文，则被「该文件**别处**用了
  `runPnpmSync`」这一巧合遮住（判据是「有没有裸起 pnpm」**且**「有没有走共享判据」，
  后者为真就整体放行）。

  修法是把剥注释补齐 —— 先剥 `/* … */` 再剥行注释，与仓里已有的同类实现
  （`scripts/lib-node-only-scan.mjs` / `check-dead-exports.cjs` 的 `stripComments`）
  同口径。**不动 `ci-cp936-exit.mjs`**：它确实复用了同一处形态判据，判据该改的是
  自己的读法，不是把正确代码改成判据认得的形状。

  反向复算：在真代码里写一句 `spawnSync("pnpm", …)`，这条判据照旧当场点名 ——
  剥掉的只是注释，不是判据本身。

  ## 三之九、第九处：转码「成功」时**输出被吞了**（第五轮的现场）

  第五轮 `类型检查` 已在 21s 内转绿（**前两处修的那两半都成立**），红往下走到
  `生成态文档与源同步` —— 而这一步的日志里**一个字都没有**：

      Runner[…]$ node scripts/ci-cp936-exit.mjs -- node scripts/render-doc-placeholders.cjs --check
      Finished, code: 1, duration: 4.5s

  **「输出被吞」与「这条命令本来就不打字」在日志上完全同形**，读的人连它红在哪一步都
  分不出来，而本地那一档是绿的。根因在 `writeCp936` 的默认实现：

      spawnSync(cmd, args, { input, encoding: null })

  那个 `null` **是对的**（要 Buffer 输出的唯一写法），可它同时意味着 `spawnSync` 的
  `stdio` 仍是默认的 `pipe`：PowerShell 编好的那批 **936 字节确实是对的**，却落进
  `r.stdout` 这个 Buffer，然后**整份丢掉**。「转码是外壳」这句话在这里被执行成了
  **吞掉被包命令的输出** —— 而它本来要保证的恰好是「原文能到日志里」。

  修法：`stdio: ["pipe", "inherit", "inherit"]` —— **只把 stdout / stderr 接出去，
  stdin 必须留在管道上**（默认值与编排那一侧显式传的那一句同改；只改一边就是
  「默认对了而编排没带上」）。

  ⚠️ 第一版修成了 `stdio: "inherit"`（一个字符串），结果是**平台日志仍然一个字都没有**
  （`E2E 关键流程`：退出 1、日志零行）：它是一句「三路都别再管」的话，配 `input` 用时
  会把那份 UTF-8 原文**静默丢掉**（stdin 变成真终端），PowerShell 的
  `[Console]::In.ReadToEnd()` 读到空串。**「标准输出落日志」与「整个 stdio 都别管」
  是两句话，而后者在形状上与前者长得几乎一样。**

  ⚠️ 这一格**Linux 上永远判不到**（非 Windows 直接 return，Windows 分支本地跑不了真
  PowerShell），所以判据钉在**形状**上、三条互补：默认实现交出去的那三路、编排真的把
  它带上了、以及**这个形状真能用**（拿 `process.execPath` 假冒 PowerShell 跑一遍 ——
  `spawnSync` 的 stdio 语义与平台无关，这条在 Linux 上判得动）。用例 29 → 32 条。

  > 这一处与第四轮那次「两条命令被当成一条」是**同一类病的两面**：那一处的出口
  > **说得太少**（读不出真因），这一处的出口**一个字都不说**（输出整份被吞）。
  > 两次都不是「判据错了」，而是**判据的结论到不了读日志的人手里**。
