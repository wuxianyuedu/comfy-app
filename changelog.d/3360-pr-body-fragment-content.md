## Added

- **`pnpm ship` 提的 PR 正文现在能看到「具体改了什么」（ISSUE #3360）**。此前概览页只有
  `changelog.d/` 的**文件名 + 段落标题**（`foo.md → ## Added`）与 diffstat，碎片里写着的
  根因 / 改动 / 代价 / 用例得点进「文件」那格自己翻；标题是这次变更的一句话，正文才是细节。
  现在 `scripts/ship-pull-body.mjs` 把每份碎片**去掉首行段落标题之后的正文原样照录**进
  PR 正文（引用块、一份一节），照搬盘上已有的字，不生成因果句（`check-commit-claims.mjs`
  复核的仍是推断句）。配套三件：
  ① 首行与正文各由 `scripts/ship-ticket.mjs` 的 `fragmentHead` / `fragmentBody` 读一处，
     不在两处各读各的；没有可贴的正文时输出与旧形态**逐字节相同**（回归用例钉着）。
  ② 碎片原文整体占 `FRAGMENT_BODY_BUDGET` 字节预算（入账 §13.5.26）：超了按**整份**
     逐份贴满、装不下的省略并念出省了几份，截断半份比不贴更糟；预算减到 0 仍装不下才走 #2248 那条
     「正文本身太大 ⇒ 不建 PR」出口。
  ③ 长度一律按 `Buffer.byteLength(text, "utf8")` 量：`ship-pr-body.mjs` 的超上限出口
     此前用 `.length`（字符数），纯中文正文会低估到三分之一，本地判「在上限内」而平台
     回 `errcode 2000003`。这条同时修掉。
- 同步面：规范 §13.6、project Skill `.qoder/skills/ship/SKILL.md`、`ship.mjs` / `ship-core.mjs`
  模块注释、`docs/generated/` 镜像（只重渲染动过的那一份）。
- 用例：`tests/ship.test.ts` 新增 7 条（照录 / 逐字节回归 / 整份省略对账 / 中文按字节量 /
  预算减到 0 / 常量同源）；全量 368 条绿，`tsc` 双份、`lint:oxlint` 0 警告、阈值账 48 条一致。
