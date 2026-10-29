## Fixed

- **主干上一条「读一份已被删掉的配置文件」的用例不再崩，并升级成行为判据**（ISSUE #2603）。
  `tests/check-file-structure.test.ts` 里 ISSUE #730 那一格 `readFileSync(".prettierignore")`，
  而那份文件随 #2541（删 prettier、格式化器只剩 oxfmt）一起被删了 —— 那一批改了「格式化工具
  是谁」，没同批改「谁引用它的配置文件」。表现不是判据红而是 `Error: ENOENT`：
  这条护栏在测试面上**静默消失**，谁跑全量单测都读到一条与自己无关的红。
- **先回答口径，再改用例**（这一步是本单的重点，不是顺手换个文件名）：oxfmt `--help` 原文
  写明不给 `--ignore-path` 时它**只读 cwd 的** `.gitignore` / `.prettierignore`，
  外加 `.oxfmtrc.json` 的 `ignorePatterns`。⇒ 今天真正兜住 `src-tauri/target/` 的是
  `.oxfmtrc.json` 那一条（`src-tauri/.gitignore` 里的 `/target/` 它看不见，与 prettier
  时代同一个道理）。**变异验证把这一层钉成了事实**：从 `ignorePatterns` 里摘掉那一条后，
  对 `src-tauri/target/` 下的文件直接跑 `oxfmt --check` ⇒ 退 **1** 并点名该文件
  （同一份文件在配置完好时退 **2** 且一个名字都不打）—— 排除的功劳确实归这份配置，
  不是归 `.gitignore`。
- **行为档（原来只读配置文本，属于「形状守不住行为」那一种）**：在 `src-tauri/target/` 下造
  一份当年被改坏的那个形状（`.js` + 一条超 `printWidth` 的紧凑数组），真起 oxfmt 判它
  **不被点名**；同批在**仓库外**的临时目录放同一份内容做对照组，判它**被点名且退 1**。
  少了对照那一侧，「没点名」与「工具根本没跑起来 / 那份文件没被看见」是同一个读数。
  两侧产物一律 `finally` 清掉。
- **同批把四处复述点一次改完**（`grep -rn prettierignore` 的非镜像命中全数处置）：
  ① `tests/check-file-structure.test.ts:1359` 本正案；② 同文件 `:201` 的 R9 反面对照夹具
  换成现役根配置 `.oxfmtrc.json`（夹具的名字要跟着现役格式化器走，不能继续给一条不存在的
  防线造现场）；③ 规范 11 章那条「文件名写进 `.prettierignore`」改指 `.oxfmtrc.json` 的
  `ignorePatterns` 并写明「换格式化器等于换那份白名单的住址」；④ 12 章 R7/R8/R9 那节与
  `launch-and-build.md` §5 的 ISSUE #730 排障行同步（后者并把两侧同批跑的判法写进去）。
- **单子期望 4 那一格一并定性**（原先「等一次干净构建再判」）：`pnpm build` 修好后（#2599 已
  落地）重跑 `tests/turbopack-tracing-excludes.test.ts` 与 `tests/executor-host-artifact.test.ts`
  ⇒ **37 条全绿**，含「在 `.next/standalone` 内真起 executor-host `--once`：exit 0 且注入链完成」。
  所以当时的红是**产物陈旧**，不是排除项失效 —— 两问的修法相反，这一格现在有读数了。
