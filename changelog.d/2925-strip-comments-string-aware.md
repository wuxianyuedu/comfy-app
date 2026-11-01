## Fixed

- **`stripComments` 会把真代码剥掉**（ISSUE #2925）。`tests/helpers/strip-comments.ts` 是
  「拿正则断言源码形状」那族判据的**唯一剥注释实现**，而它的块注释那一条
  （`/\*[\s\S]*?\*/`）**不跟引号状态** —— 于是**字符串字面量里的 `/*`** 被当成块注释起点，
  一路吃到下一个 `*/`，中间的真实代码整段消失。

  后果方向是这一族最坏的那一种：对正向断言是"判不到"，对 `not.toMatch` 是**假绿**
  —— 被禁写法只要落在那一段里，判据永远看不见它，而账面照常全绿。

  当场读数（量具 = 逐行比对原文与剥后，只数"那一行本身既不含 `//` 也不含 `/*`"的消失行 ——
  那种行只可能是被**别人的**注释吃掉的）：

  ```
  scripts/dev-launcher.mjs              /* 63 vs */ 61  整行消失 59 行
        import fs from "node:fs";
        import { resolveAppPort, resolveRepoRoot } from "./app-port.mjs";
  src-tauri/src/lib.rs                  /* 12 vs */ 11  整行消失 50 行
        let app_root = res_dir.join("static");
  scripts/build-desktop.mjs             /* 21 vs */ 16  整行消失 33 行
        const exported = spawnSync(invocation.command, invocation.args, {
  scripts/standalone-private-inputs.mjs /* 45 vs */ 32  整行消失 33 行
        "executor-host.runtime.mjs",
  ```

  这四份不是边角：`build-desktop.mjs` 里消失的那几行含 `spawnSync(...)`（正是
  「起进程不许经 shell 层」那一族的判点），`standalone-private-inputs.mjs` 里消失的是
  **产物白名单条目**，而那份文件是 **9 份用例的接收者**
  （取法：`grep -ln "standalone-private-inputs" tests/*.ts`）。

- **改法：整份实现改成一遍字符扫描**，块注释起点只在"当前不在字符串里"时成立。
  两个细节是量出来的，不是设计的：

  1. **单/双引号的字符串状态按行重算**。第一版我做成全局状态机，结果在本仓翻车：
     `scripts/base-check/hook-steps.mjs:203` 一条正则字面量 `/["']\s+sh -c/gm` 里那个
     **落单的 `'`** 把字符串状态传染到后面几十行，导致紧随其后的**真块注释**没被剥掉 ——
     注释里的 `spawnSync("pnpm", …, {shell:true})` 于是被 `spawn-shell-scan` 报成违规
     （假红）。JS 里这两种引号本来就不能跨行，按行重算就把污染关在那一行内；
     模板串（反引号）确实跨行，所以只有它把状态带走。
  2. **块注释内部的换行照旧丢弃**，与旧实现输出形状一致。这一族判据里有
     `[\s\S]{0,400}` 那种窗口式写法，保留空行会改变窗口内看到的字节数 ⇒ 改动面按
     "只修缺陷、不顺手改形状"收。

  修完复算：上面四份**整行消失全为 0**，同时 `hook-steps.mjs` 注释里那两处 `shell:true`
  仍被正确剥掉（原文 2 · 剥后 0）。

- **`tests/strip-comments-single-source.test.ts` 加了两格钉子**：夹具一格（甲乙两向各钉一条实测
  失效形状：glob 串里的 `/*` 不许吃掉真代码；正则里落单的引号不许放过真注释），
  **真文件一格**（把同一把尺打在 7 份判据接收者上，名单含 `dev-launcher.mjs` /
  `build-desktop.mjs` / `standalone-private-inputs.mjs` / `lib.rs` 等）。
  **变异证明两格都红在旧实现上**：

  ```
  AssertionError: expected 'const PATTERNS = ["**archive/*.md"];\…' to contain '**/*.log'
  AssertionError: scripts/dev-launcher.mjs：剥完有 59 行真代码整行消失（#2925 那一形，
                    反向断言会在看不见它的情况下绿）。首行：import fs from "node:fs";
  Tests  2 failed | 4 passed (6)
  ```

  第二行的 59 与本单立案时的探针读数**逐字相同** —— 这就是"钉子打在真对象上"的意义：
  夹具只能证明机制，真文件那一格才会在有人把实现换回去的当天红。
  注意「4 passed」—— 旧实现这一形在仓里**没有任何别的格子会红**。摘掉变异后 helper 与快照
  逐字相同（`sha1sum` 对得上、`node --check` 过、三文件 eslint 退 0、`tsc --noEmit` 退 0）。

- **修好之后暴露出的两格，都是真暴露不是新 bug**（这点要分清，否则会把修复当肇事者回退）：
  1. `tests/probe-restore.test.ts` 那条「tests/** 里不许拿 git 索引/HEAD 清工作区」开始红在**它自己**
     身上：它的夹具数组与失败文案里原样写着被禁形状。此前不红，是因为那份文件尾部**正被旧实现的
     幻影块注释吃掉**。按仓里既有的处理（`strip-comments-single-source.test.ts` 用 `DEFINITION_MARK`
     拼接避开自匹配）把这些串改成拼接写出 —— 拼出来的**值**与原字面量逐字相同，
     由同文件「被禁的三种形状各自命中」那一格证明，不是靠"现在不红了"自证。
  2. `scripts/spawn-shell-scan.mjs` 那一格先红过一回，成因就是我上面说的第 1 点（正则里落单引号），
     按行重算后转绿。

- **执行面**：这条改的是 31 份用例共用的形状判据前置，所以验收跑的是**全部 31 份消费者**，
  不是只跑 helper 自己的用例：`Test Files 31 passed (31) · Tests 507 passed (507)`
  （取法：`grep -ln "helpers/strip-comments" tests/*.ts` 现算消费者名单，逐份点名跑；
  规范 §13.5 第 12 条要求的正是这一格 —— 该处当年记的「它有 29 份」是**那一天的读数**，
  今天现算是 31 份，别把那个历史数当现值用）。

- 一条自我修正顺手记下：我给这份 helper 写"边界说明"时，把 `/\/\*/` 原样写进了块注释里 ——
  那串里的 `*/` **把这段注释自己关掉了**，后半截变成一条悬空表达式。`node --check` 与
  `tsc --noEmit` 都不报（中文是合法标识符，那串恰好构成一个表达式语句），是 **eslint 的
  `no-unused-expressions` 报出来的**。这条边界现在有了两处落点：helper 文件头的「不识别正则字面量」
  那两行（人读的那一份），以及上面那格钉子（机器判的那一份）—— 记在这里是因为它正发生在
  "教别人怎么剥注释"的那个文件里，而下一次读它的人会以为那份说明是注释。
