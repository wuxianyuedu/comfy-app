## Changed

ci: CNB PR 档薄化成「平台读数 + 判决链」，静态判据只由 GA `pr-gate.yml` 判一次。

`.cnb.yml` 的 `质量门禁`（PR 档）与 `.github/workflows/pr-gate.yml` 此前在同一个 PR
事件上跑同一批静态判据 —— 同一份结论算两遍，而 PR 档的墙钟是这台自托管节点最紧的
共享资源。本次只改**执行者**、不改判据：

- **PR 档保留两类**（GA 覆盖不到，摘了就没有执行者）：
  - 平台读数：`镜像身份` / `工作区复用读数` / `缓存槽读数` / `环境前提` ——
    问的都是这台节点的事实（runner 身份、工作区复用路径、pnpm 槽根、工具链在不在）；
  - 判决链：`GitHub 镜像同步` → `GitHub 判决回读` → `日志分块 1/3…3/3` → `GitHub 判决判定`。
- **撤出 24 格**，各自在 GA 有对应 job / step（逐项归属见
  `docs/standards/13-提交与-code-review.md` §13.5.33 与 `.cnb.yml` 的 `.gates` 顶部同表）：
  `分支守卫` / `提交声明核对` / `同步数据库表结构` / `类型检查` / 十四格静态判据
  （`标题行让位` … `lib Node-only 声明`）/ `oxfmt 格式` / `重档静态判据`（含
  `格式化提交分离` / `零消费导出`）/ `Install dependencies`。
- **`格式化提交分离` / `零消费导出` 留在 `COMFYAPP_CI_GATES` 与台账 PR 段**：
  它们是「换了执行者」（`COMFYAPP_CI_GATES_ELSEWHERE` 仍登记入口路径），不是删除；
  `.gate-executor-ledger.json` 的 `judges` 同步写明现由 GA 的 `重档静态判据` job 执行。
- **台账与判据同批对齐**：`GATE_TIER_LEDGER` 把撤出的 22 条登记为 `retired`（每条 note
  写明 GA 执行者）、`INCREMENTAL_GATES` 删掉 14 条 PR 静态判据收窄、`CROSS_LANE_SCRIPT_MIRRORS`
  对账面改成「每日 ⇄ push」（PR 档此后没有安装格）。
- **测试改判方位**：`tests/no-platform-ci-config.test.ts` / `ci-incremental-gates.test.ts` /
  `doc-check-hook-wiring.test.ts` 里原本读 `.cnb.yml` 的 oxfmt、文件结构等断言，改为读
  `.github/workflows/pr-gate.yml` 的同一命令形状，并断言它们**不在** `COMFYAPP_CI_GATES`。
- **文档源同批**：`docs/standards/13-提交与-code-review.md` §13.5 两层表新增「平台（代码判据）」
  行、§13.5.1.1 oxfmt 执行者行改指 GA、§13.5.23 的镜像出勤口径改写（承重只改退码归属，
  `status` 仍只回答退没退非零）、新增 §13.5.33 记薄化与 24 格归属。
- **`mirrorAttendance` 注释过期**（`check-mirror-attendance` / `ci-build-classify` /
  `quality-gate`）：由「读数档、恒不退非零」改为「2026-11-05 起承重（摘 `--readout`），
  出勤仍从正文三态原值认」。

## Fixed

- 同一个 PR 事件上同一批静态判据不再算两遍（CNB PR 档墙钟随之下降）。
- 注释仍在教「镜像同步是读数档」的三处脚本头注与规范同批订正，避免下一个读者按旧口径判。
- 顺手修两条主干既有红（与本单同一类「执行者/取证路径」问题，不修则合并闸过不去）：
  - `scripts/ci-mirror-lfs-push.mjs` 的 `git lfs ls-files --long` 补 `-c core.quotePath=false`
    （读 git 路径的调用同口径，`tests/git-path-quoting.test.ts` 钉着）；
  - `scripts/check-merged-side-loss.mjs` 的逐字节取证改走 `merged-side-loss-git.mjs`
    新导出的 `readBlobText()`，不再在执行者里直接 `["cat-file", …]`
    （`tests/merged-side-loss-git.test.ts` 钉着）。
