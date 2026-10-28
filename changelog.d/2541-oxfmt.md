## Changed

- **格式化器 prettier → oxfmt，门禁「prettier 格式」改名「oxfmt 格式」（issue #2541）**。
  prettier 全量 `--check` 实测 ~108s、`check-format.cjs` 热跑 234s；oxfmt 同面
  **1.9s**。切换后与默认构建链（Turbopack）同链，且 `sortTailwindcss` **内置**
  —— `prettier-plugin-tailwindcss` 一并删除。
  - 依赖：加 `oxfmt`；`format:check` / `format:write` 换 oxfmt 并**收口到门禁面**
    （`src/**` + `.storybook/**`）—— 原来那个宽 glob 会把 `scripts/**` 带进来误报。
    ⚠️ `prettier` / `prettier-plugin-tailwindcss` 本批**故意暂留**（下一批删）：
    删依赖与删 `prettier.config.js` 同批会让基线快照的 tsc 撞 TS2307
    （master 那份配置里的 `import("prettier").Config`），基线复算 inconclusive。
  - 配置：`prettier.config.js` 删除，改 `.oxfmtrc.json`（由 `oxfmt --migrate prettier`
    迁移；差异面 32 份，已独占一条提交重排）。
  - 执行者链同批改名（标签被 5 个测试文件按字面钉死，必须原子改）：
    `ci-autofix-duties.mjs` / `ci-incremental-gates.mjs` / `.cnb.yml` stage 与
    `COMFYAPP_CI_GATES` / `quality-gate.mjs`+`.ps1` / 5 份测试 / 4 份源文档 +
    生成物。

## Added

- **换格式化器时给「格式化迁移」一条显式出口：提交正文尾注 `format-migration: <一句话>`**
  （issue #2541）。两条硬闸在迁移这件事上**互锁**：格式判据是硬闸且没有基线 ⇒ 全量
  重排必须与切换同批落地；而「格式化提交分离」的阈值（10）又会拦住同批里的重排 ——
  迁移没有可落地的形状。声明了就按迁移读（不阻断），但清单照打、读数照报（可审计），
  且带两道护栏：① 区间里**每个**提交都要声明；② **逐提交**看，重排要么不到阈值、
  要么那条提交整条都是重排（刻意不留「占比 90% 就放行」那种缝 —— 那是每 10 份重排
  夹带 1 份功能改动）。护栏 ② 按**提交**算而不是按区间汇总：切换那一笔要改判据脚本、
  文档、依赖清单，汇总口径会把它们算进分母（实测 32/56 = 57%），把「重排独占一条」
  这个正确形态拦死。

## Fixed

- **`check-reformat-only.cjs`（格式化提交分离硬闸）的取数不再依赖格式化器输出文案**。
  prettier 时代靠解析 `--write` 的 stdout、按行尾 `(unchanged)` 标记分三档（还得先剥
  颜色码）；oxfmt 写盘输出没有这个标记，改为**写盘前留快照、写盘后回读比对正文**
  定「改写过没有」，「批量退出 0」即全员有结论。判定从今只依赖文件内容本身 ——
  将来再换格式化器不会因为文案变一次而漂。
