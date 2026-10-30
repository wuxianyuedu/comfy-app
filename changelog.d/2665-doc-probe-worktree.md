## Fixed

- **写探针不再落进真实入库文档：搬进一次性的 `git worktree` 克隆（ISSUE #2665 / 规范 §11.16.3）**：
  #2593 修好了「还原别拿 `git checkout` 当凭据」那一半，但**读的那一侧一直敞着** ——
  这类用例的形状是「往真实入库文档改一笔 → 起子进程跑判据 → 还原」，而 vitest 按**文件**并行，
  所以那段窗口里任何并发读者读到的都是探针那一笔，不是仓库事实。当场量的三件：
  一次 `node scripts/check-doc-references.cjs` = **252ms / 242ms**（同进程连跑两次，本机 ReFS）
  就是那段窗口的长度；那份用例有十几组探针各开一次；而**已确认在场的读者**是
  `tests/comment-language.test.ts` —— 它直读 `docs/reference-facts.md` 逐行找
  `comment.language.asciiOnly` 那一行，而那份文件正在写探针名单里。

  新件 `tests/helpers/probe-worktree.ts`：`git worktree add --detach <临时目录> HEAD` 出一份干净快照，
  再把真实树里**脏的那几份**（改 / 新建 / 未跟踪**目录** / 已删除）逐项搬进去 ——
  于是克隆是「此刻工作树的忠实副本」，判据在里面看到的与作者看到的一致，而真实树一次都不被写。
  一棵**文件级**的而不是每组一棵：`worktree add` 实测 **4.81s / 3158 份文件**，
  十几组各一棵会把这段从秒级抬到分钟级而隔离量是零（同一棵工作树里的两组探针本来就不并发，
  vitest 文件内串行）；要挡的是**别的用例文件**同时读同一份文档。
  两条边界写进件里：建不出来**抛**，不许静默退回真实树（退回=把这一档关掉而账面全绿）；
  不建 `node_modules` 的 junction（判据只要 `node:` 内建 + 本地 `.cjs`，实测裸工作树跑得起来），
  将来若要接，先读 `scripts/base-check.mjs` 那段「必须先摘 junction 再删 worktree」。

  **那道收尾网的语义跟着换了**：`tests/check-doc-references.test.ts` 的 `afterEach`
  原来「把名单里那几份还原成快照」，现在**断言它们逐字未变** —— 红的意思从「探针留脏了」
  变成「有探针绕过克隆去写真实树」。#2593 那条「不许拿 `git status` 当『探针留脏了』的证据」
  的口径完整保留（快照仍取在模块加载时、仍取真实树那一版）。

- **两处是这份新件自己撞出来的**（都留在件里，不是顺手改掉）：
  ① 第一版把分隔符写成 `resolve.sep`（`resolve` 是函数，`sep` 挂在模块对象上）⇒ 拼出
  `<克隆目录>undefined`，**每次合法拷贝都被自己的守卫拦下**；
  ② 更要紧的一格：`add` 成功之后中途抛错时，`.git/worktrees/` 那条登记会**留在仓库上**，
  指向一个之后已被删掉的临时目录 —— 之后每个人 `git worktree list` 都看得见那个幽灵
  （本次现场就留下过一条，已手工 `worktree remove` 清掉）。于是加了「中途抛错先注销登记再抛」
  那一段，并配一条**注入式**用例钉住它（没有注入口就只能靠真的把磁盘弄坏去测，那不可重复）。
  还有一个自己写的**恒真断言**：`expect(listed).toContain("tree")` —— 夹具路径本身就叫
  `…-gate-XXXX`，那句永远为真；换成比规范化后的完整路径（`git worktree list` 在 Windows 上
  打 `G:/Temp/...` 形，Node 给反斜杠形，不规范化就永远「不包含」，反向也假）。

- 顺带把 §11.16.2 那段「已知边界」接上新的一面（还原 vs 不写是两件事），并新增 §11.16.3
  写清这条口径；`docs/generated/11-…` 镜像按 `doc:render -- --only` 只重生那一份
  （源与镜像各 +42 行，互相对应）。清单加一格之后当场查过：规范里那句「固定清单 77 份」
  本来就标着「**当时那份清单**的份数，现值以 `FIXED_STRUCTURAL_TESTS` 为准」⇒ 不是会被
  本批改假的话，所以没动它（查过再决定不改，与没查就抄是两件事）。

  凭据（四条，含一条变异）：
  ① 新用例 `tests/probe-worktree.test.ts` **4 条全绿**（1.8s）：脏的四种形状逐项进克隆
  （含「真实树没被顺手还原」这一句）、`dispose` 之后登记与临时目录都没了
  （比的是 `worktree list --porcelain` 里剩下的完整路径，不是条数）、中途抛错不留登记、
  建不出来时抛；
  ② 消费方与被怀疑的并发读者一起跑：`tests/check-doc-references.test.ts` +
  `tests/probe-worktree.test.ts` + `tests/probe-restore.test.ts` +
  `tests/comment-language.test.ts` 合跑 **108 条全绿**（EXIT=0）；
  ③ **变异**：在那份用例里故意绕过克隆去写真实树 ⇒ `afterEach` 当场红并点名那一份、
  话术直接指着「写探针要落在克隆里」；撤销变异后复跑全绿（撤销用的是本批自己的备份 ——
  那份文件本批已改了未提交的内容，`git restore` 会连本批的改动一起丢掉）；
  ④ 判据面与类型面：`check-doc-references.cjs` EXIT=0（含新的 §11.16.3 那一格）、
  脚本档 `check-scripts-typecheck.cjs` = **面 215 / 存量 0 处**、应用档
  `pnpm exec tsc --noEmit` **EXIT=0**、`pnpm exec eslint` 对四份改动件零输出
  （第一版有 6 条：两处 `prefer-string-starts-ends-with`、一处 `preserve-caught-error`、
  两处「该用 `!`」—— 后两处的正解是**守卫而不是断言**，`if (!tree) throw new Error(...)`，
  抹掉 null 只会让下一条以另一种形态红）。
