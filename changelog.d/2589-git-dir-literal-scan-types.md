## Fixed

- **脚本档清账批 22（收尾）：`scripts/git-dir-literal-scan.mjs` 4 格清零，账从 4 处 / 1 份降到
  0 处 / 0 份 —— ISSUE #2589 那条「320 处按文件逐条清」的账见底**（规范 §13.5.14.1）：
  这一份守的是「检出目录在哪只有 `scripts/git-dir.mjs` 一处知道」（ISSUE #2072：链接工作树里
  `.git` 是个**文件**，硬拼指向它 ⇒ `MERGE_HEAD` / `HEAD` 永远查不到）。

  两格是 `collect(dir, out = [])` 的形参。**`out` 那一格值得说一句**：默认值 `[]` 在类型上是
  `never[]`，于是函数体里那句 `out.push(full)` 报「推不进去」——而它是**递归各层共用同一个数组**
  （`collect(full, out)` 把同一个引用一路传下去，返回值就是最初那一份），
  所以类型写的不是「一个数组」而是「同一个累加器」。写成 `@type {string[]}` 在调用点上重新建一个
  就把它改成了另一件事。另两格是 `offenders` 的累加清单声明（`string[]`，元素形状是
  `相对路径:行号: 原文`）与它的消费点 `forEach((o) => …)` 跟着掉的那格。

- **同批改掉账本里那句会变成假话的散文**：`scripts/check-scripts-typecheck.cjs` 每次 `--update`
  都会把一段 `note` 写进 `scripts/.scripts-typecheck-baseline.json`，而那段话的最后一句是
  **「为什么剩下的不清零：约一半是 `TS7006`…另一半是要在启动链与构建链加守卫的真改动」** ——
  账清到 0 之后这句话还在被重写，读的人据此以为还欠着 300 处。
  现在改成如实的**空账声明**：`files` 是 `{}`、`total` 是 0，本档不再登记任何「已知欠账」，
  任何一格出现都是新增 ⇒ 红；「当初为什么不当场清零」那句保留，但**归位到它的出处**
  （ISSUE #2589 与提交信息里那个「脚本档清账批 N」的主语前缀），而不是留在账上冒充现状。
  这是本仓反复记的那一型：**判据的说明文字也是会被机器重写的产物，它说的话必须跟着事实改**。

  凭据（四条，含一条专门证「空账 ≠ 判据空转」的变异）：
  ① **空账之后仍然会红**：往一份与本批无关的 `scripts/git-dir.mjs` 末尾追加一个无形参类型的
  函数（`export function probeMutation2589(a) { return a + 1; }`）⇒ 默认档 **EXIT=1** 并逐格点名
  `scripts/git-dir.mjs TS7006: 基线 0 → 当前 1（新增 1 处）`，随后 `git restore` 撤销、
  `git status` 自证零残留。⇒ 账到 0 不是把判据关掉了，是把额度关掉了。
  ② 本份脚本的**两种输出形态逐字未变**（它是有出口形态之分的判据）：人读档打
  `[git-dir-literal-scan] OK：检出子目录字面量只存在于 scripts/git-dir.mjs` 退 0；
  `--json` 打 `{"ok":true,"offenders":[]}` 退 0 —— 改动前后各跑一次、两份 `diff` 都为空。
  ③ `tests/git-dir-literal-scan.test.ts` + `tests/spawn-shell-scan.test.ts` 串行 **28 条全绿**，
  `tests/scripts-typecheck-ratchet.test.ts` **11 条全绿**（含「账本的 `face`/`total` 与配置展开同数」
  与「被语法层截断的一跑不许冒充结论」那两条），默认档复算 = **面 215 / 存量 0（基线 0）** EXIT=0；
  ④ `node --check` 两份都通过；`pnpm exec eslint` 对这两份零输出；`pnpm exec tsc
  -p tsconfig.scripts.json --noEmit` 的 `error TS` 行数 = **0**（判决面整跑，不是可达闭包）。
