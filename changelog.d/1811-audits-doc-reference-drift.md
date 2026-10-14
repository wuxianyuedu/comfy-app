## Added

- **`docs/audits/**` 的引用漂移有了执行者**（ISSUE #1811 收尾遗留项，
  `tests/audits-doc-references.test.ts`，7 条，进 `FIXED_STRUCTURAL_TESTS`）。

  那份架构风险审查台账**自己写下了**这句话：「`docs/audits/**` 不在 `doc:check` 的
  核对面里，所以这份台账自己的引用漂移没有判据会红」—— 它连自己都没能把这句话
  变成红的（`doc:check` 的遍历面是 `SCOPED_DOC_DIRS`，只含 `docs/standards` 与
  `docs/guides`）。于是 ISSUE #1811 收尾把 20 份棘轮基线删掉、四条判据升硬闸之后，
  台账里仍写着「基线 `scripts/.dead-exports-baseline.json`」而没有任何东西会红。

  判据面**刻意**收窄成一件事：台账点名一份 `scripts/.*-baseline.json` 基线、
  而该文件已经不在、且同一行没有写明它是历史快照 ⇒ 红。「哪些基线被删过」现从
  `git log --all --diff-filter=D` 算，**不抄第二份清单**，下一次翻闸自动进判据面。

  **不收的那一半同样重要**：`src-tauri/static` 在台账里出现两次而该目录今天不存在 ——
  它是**构建产物**（`.gitignore` 忽略、`git ls-files` 为 0），`docs/standards/12` 是
  **章节号**。任何「台账里的路径都得存在」的判据在这里必然假红一片，
  而会误报的判据活不过一次评审（§11.18.4）。

  这一层有两个**最坏的失效形态**，各自有用例钉住：`git` 不可用（浅检出 / 沙箱）时
  名单退化成空集、判据恒绿 ⇒ 「判据面非空」那条正面断言仓库历史里确实删过基线；
  沿革叙述被误判 ⇒ 合成文本双向各跑一遍（带「已删 / 当日快照」放过、不带则红）。

## Fixed

- **台账里三处指向已删基线的引用**（同上）：结论摘要里 R3-01 落地那条点名的
  `.infra-file-size-baseline.json`、以及它下面那句订正里同一份基线，各加注「已删」；
  「判据覆盖 ⇄ 证据」表第 7 行的 `scripts/.dead-exports-baseline.json` 标成「**当日**基线」。
  三处都是判据第一次跑当场点名的。
