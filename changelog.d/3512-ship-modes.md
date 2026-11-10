## Added

- **`pnpm ship` 提供工作模式（ISSUE #3512）**：三种模式，默认档行为一字不变。
  - **`--mode auto`（全托管）**：一次点名授权一组显式动作 =
    `--merge --close-issue --clean-branch`。CI 出终态且为绿 ⇒ 合并；合并验真 ⇒
    关单（本轮落地行点名的号 ∪ 人点名的号）⇒ 删这次那条分支。它是打包旗标的
    **显式别名**——模式由人点名、展开发生在解析层（阶段表不认识「模式」这个词），
    终态仍只认 build 的 `data.status` 与 PR 的 `is_merged` 两个原值；
    不新增判定、不新增绕过口，四条红线原样适用。
  - **`--mode confirm`（关键步骤确认）**：同一组动作，但合并 / 关单 / 删分支每步
    先问一句 `[y/N]`（读自 stdin，可注入）；回答不是 `y` / `yes`（含 EOF /
    非交互）按**未授权**处理：跳过该动作、当场念出手动出口，收尾结论行汇总
    跳过清单——**跳过不是失败**（与默认不给 `--merge` 的那一跳同状态），
    但跳过必须被读出来，不许长得像执行过。CI 已红的那一跳不问合并
    （问了也会被验真守卫拒掉，照旧走「给了 --merge 而 CI 红 ⇒ 退 1」）。
    确认应答 fail-closed：拿不到「y」就是未授权。
  - **默认（不给 `--mode`）**：现状不变，逐旗标显式。模式与单件动作
    （`--claims` / `--diagnose` / `--reap` 等）的互斥走既有 namedActions 清单；
    词表只有 `auto` / `confirm`，词表外 / 重复 / 缺值 ⇒ 退 2 不静默收下。
  - 实现收在 `scripts/ship-mode.mjs`（词表 / 展开 / 确认应答，与 `ship-args` 同一档
    「跟着命令行长什么样动」）；单元档 `tests/ship-mode.test.ts`，整链集成档进
    `tests/ship.test.ts`。文档同批：规范 §13.6 新增「工作模式」段、
    project Skill `.qoder/skills/ship/SKILL.md`、AGENTS 硬规则 28 摘要、
    `scripts/ship.mjs` 文件头用法全表。
