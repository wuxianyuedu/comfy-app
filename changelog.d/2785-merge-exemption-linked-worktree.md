## Fixed

- **「合并态豁免」在链接工作树里永不点火，而防这一族的扫描面不收 CJS（ISSUE #2785）**。两半同批，
  因为第二半正是第一半能静默存在的原因。

  - `scripts/check-reformat-only.cjs` 判「本次提交是不是合并提交」用的是
    `fs.existsSync(path.join(ROOT, ".git", "MERGE_HEAD"))`。链接工作树（`git worktree add` 出来的
    那种检出）里 `.git` 是一个 `gitdir: …` **文件**，拼出来的路径永远读不到 ⇒
    「合并会把上游整批格式化带进来，这一档不适用」这条豁免在那种检出里**从来不生效**：
    表现不是红，是**该跳过的判定照跑**，于是在 worktree 里做一次 `git merge` 会被要求
    「把格式化拆成两次提交」——而上游形态已定死在历史里，本地做不到。
    改法：取 `scripts/git-dir.mjs` 的 `hasInProgressMerge(ROOT)`（#2747 为 `check-format.cjs`
    建的那一份，同一件事的第二处使用），不再自己拼检出位置。
  - 防这一族的判据 `scripts/git-dir-literal-scan.mjs` 的收集面**只认 `.mjs`** ⇒
    `scripts/**` 那 86 份 `.cjs` 全在面外 —— 上面这一处正是 `.cjs`。防「又有人硬拼一个检出
    路径」的护栏，恰好漏掉了这一族第二次发生的文件形态（#2072 修的四例都是 `.mjs`）。
    扩面到 `.mjs` + `.cjs`。

  ⚠️ **扩面前先普查命中并分类，这一步改变了做法**：直接把面从 `.mjs` 扩到 `.cjs` 当场报 4 处，
  其中 **3 处是正当写法** —— `check-comment-language.cjs` / `check-cp936-glyphs.cjs` /
  `check-dead-exports.cjs` 里的 `[".git"]` 是**目录遍历的跳过名单**，问的不是"检出目录在哪"。
  把它们塞进白名单等于**按整份文件**永久豁免这三份（下一次它们真拼一个检出路径，没人会红）。
  所以改的是**谓词**：解析成 AST，只认「`join(...)` / `resolve(...)` 的实参里那个字符串字面量
  等于 `.git`」的形状 —— 跳过名单、注释、话术字符串（`console.error("请删掉 .git/MERGE_HEAD")`）
  天然不在判点里。这正是 §13.5.x 与 #2660 反复付过学费的那条「整档搜字面量没有语义作用域」。
  成本上仍便宜但不为零：先做一次 `src.includes('".git"')` 的前置过滤，绝大多数文件不解析；
  本回合实测整脚本墙钟 **1.79s**（`T0=$(date +%s%3N); node scripts/git-dir-literal-scan.mjs;
  T1=$(date +%s%3N)`，本机、与两条 PR 构建并发 ⇒ 只当量级看）。这一格在固定清单里
  （`scripts/fixed-structural-tests.mjs`，每次提交都跑），所以这个数是要付的 —— 记在这里，
  别让它下一次靠"看起来没变慢"过关。

  已知盲区**写在文件头并有用例钉住**（拼接与模板形态 `root + "/.git/MERGE_HEAD"` 不判）：
  要判它就得同时判"这个字符串是不是被当话术用的"，那是语义不是形状；历史四例全是 `path.join`。
  那条断言的作用是**把盲区钉成有人的** —— 将来扩谓词时它会红，逼着改的人同时改这段说明。

  用例：`tests/git-dir-literal-scan.test.ts` 从「真实仓库现在 0 命中」一条，扩成谓词逐形对照
  （正例两种宿主 + 报出行号原文；反例三形正当写法 + 普通字符串比较；加那条盲区断言）。
  `tests/check-reformat-only.test.ts` 新增一条**链接工作树**里的豁免用例（夹具走
  `git worktree add`，工作树自己的 gitdir 由 `git rev-parse --git-dir` 说、不猜路径），
  为此给共享夹具 `tests/helpers/gate-repo.ts` 的 `run()` 加了一个可选 `cwd`
  —— 有些判据的根取的就是 `process.cwd()`，不换 cwd 就永远演不出"另一种检出形态"。
  **变异证明**：把那一行换回硬拼的 `path.join(ROOT, ".git", "MERGE_HEAD")` ⇒
  新用例当场红（它落到的不是豁免，而是「无可比父提交」那一支），还原后绿。

  顺带一条同批事实：`check-format.cjs` 里那句「不能硬拼 `<根>/.git/MERGE_HEAD`」的注释
  早就写着这一族的成因 —— 上一轮修的时候只收了自己那一处，没把面扩到 CJS，
  于是同一个坑在隔壁那份 `.cjs` 里等着（「修判据要搜被测面的旧注释」那条纪律的又一次应验）。
