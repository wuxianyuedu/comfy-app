## Fixed

> 接替 PR #3039（分支 `test/2660-standalone-strip-faces`，基线 `dc842a34` 已落后于主干）：
> 本 PR 在其提交 `0c3cf3911` 的内容之上移植到当前 `master`，并重跑全门禁。

- **「守卫自身的可运行性」那一组自扫描时用的是一条无锚的剥注释，它会把同一行引号之后的代码整截丢掉**
  （ISSUE #2660 的第六批收窄，对象 `tests/standalone-runtime-completeness.test.ts`；
  同时收掉的是 ISSUE #2969 普查到的 13 份"内联链式副本"里的第一份）。

  原来那份是就地写的两跳替换，第二跳是「两个斜杠一直到行尾」的全局替换**没有行首锚**：

  ```
  136:  const code = source.replaceAll(〈块注释那一跳〉, "").replaceAll(〈两个斜杠到行尾那一跳〉, "");
  ```

  这正是 `tests/strip-comments-single-source.test.ts` 的 `NAIVE_LEDGER` 一档点名的形状，
  它自己的注释写得比本碎片清楚：对 `const url = "http://a"; wfParam(); // 收尾` 这样一行，
  全局替换之后 `wfParam` 直接消失，于是「源码里不许出现 X」那类断言**假绿**。
  而这一份**两根特征串都躲过了**：名字那一根要的是函数定义本身（它没起名字），
  NAIVE 那一根写死了一个字面形状（它换了同义写法）。

  **当场对照（把被禁形状藏在同一行的引号之后）**：在自扫描的接收者里加一行
  `const demoUrl = "http://a.example"; const filesShadow = runtimeFiles();` ——

  ```
  老那一形（无锚）命中的裸调次数 = 0 ⇒ 判语 绿（**藏在字符串后面的裸调看不见**）
  有锚那一形命中的裸调次数 = 1 ⇒ 判语 红（点名抓到了）
  helper 那一份端到端复跑：AssertionError: expected [ '= runtimeFiles()' ]
                            to have a length of +0 but got 1
  ```

  （前两行是内存副本上的字符串级复算，仓库文件没动；第三行是真跑 vitest 的读数。）

- **三个接收者改成先剥注释再判**（`next.config.js`、`scripts/start.mjs`、自扫描那份）。
  换之前逐条量过判决会不会动：

  ```
  next.config.js     原文 11305 字符 · 剥后 4414（差 6891）
    正向 顶层键那形 原文 1 命中 · 剥后 1 命中        正向 includes 串 原文 true · 剥后 true
    反向 excludes+next-server 那形 原文 0 · 剥后 0
  scripts/start.mjs  原文 4862 · 剥后 2279（差 2583）
    正向 两条各 原文 1 · 剥后 1                     反向 三条 原文 0 · 剥后 0
  ```

  ⇒ **今天不改任何判决**（四条反向 needle 剥前剥后都是 0），买的是"下一个人在
  `next.config.js` 的注释里解释一句为什么不用 excludes"不必被迫撒谎 —— 那份文件 6891 字符
  是注释，这种解释随时会来。

- **新增一格把自扫描的前提变成显式结论**：`runtimeFiles` 的声明必须在接收者里、剥完不是空文。
  这条不是装饰 —— 那一组里 `toHaveLength(0)` 判的是"不许出现"，而读错路径 / 读空都是绿。
  **变异证明**：把自扫描的路径指到 `next.config.js` ⇒ 三格各自红，
  红话就是新加的那条（`自扫描的接收者里没有 runtimeFiles 的声明 —— 读到的不是这份文件本体
  （路径漂了），那么「裸调 = 0 次」会在一个没有对象的地方绿`）。

## 两条自我修正（都发生了，写下来是因为它们的执行者各不相同）

1. 我在这份文件的新注释里**原样写了**那两根特征串之一 ⇒ `tests/strip-comments-single-source.test.ts`
   当场点名「又多出 1 份 stripComments 的本地实现：tests/standalone-runtime-completeness.test.ts」。
   这正是那条判据把自己的特征串拆开写的原因，而我作为写注释的人第一次撞上去就成了现行犯 ——
   判据没错，错在我没照它已经用过的写法来。改成拆开描述后两格复绿。
2. 上一版我还把带「星号紧跟斜杠」的那串写进了块注释里 ⇒ **注释被自己提前关掉**，
   整份文件在 vitest 的 transform 阶段 `PARSE_ERROR`（不是红在断言上，是收不到用例）。
   同形本会话在 `tests/helpers/strip-comments.ts` 上已有一次，那次执行者是 eslint 的
   `no-unused-expressions`，这一次是**打包器**——两道都不是 `tsc`（`tsc --noEmit` 两次都退 0）。

执行面：本文件 10 条绿 / 4 条按产物在否跳过、`tests/strip-comments-single-source.test.ts` 6 条绿、
`tsc --noEmit` 退 0、`eslint` 退 0。台账里那份**具名**本地副本（`tests/shell-self-launch.test.ts`
的 HTML 开关型）**没动** —— 换过去会改变那条判据看到的文本，归 #1192 那条账（已关）与 #2969 的分类步骤。
