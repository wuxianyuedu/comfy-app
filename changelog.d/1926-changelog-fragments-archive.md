## Fixed

- **`changelog.d/` 攒了 1292 份碎片从没并入过，整理成单个归档文件（ISSUE #1926）**：碎片流程（规范 §13.10.5）约定「一件变更一个文件，整理时由 `merge-changelog-fragments.mjs` 并入 `CHANGELOG.md`」，但这条流程**从没跑过完整一轮** —— `changelog.d/` 里躺着 1292 份、最早的是几轮发布之前写的。代价两条：① **没有任何一次阅读能回答「这批改动合起来是什么」**（答案被切成上千个文件）；② **`ls changelog.d/` 无法回答「还剩哪些没并入」**（里面躺着的东西与「今天刚写的那一份」长得一模一样）。
  - 修法 = 全部碎片**原文**收进仓库根的 `CHANGELOG-archive.md`（逐份收录、一字未改、带条目索引与段落列），`changelog.d/` 退回它本来的语义 —— **只放尚未并入的条目**，现在只剩 `README.md` 与将来的碎片。
  - **为什么不把 1292 份全并进 `CHANGELOG.md`**：这些碎片里绝大多数是**治理类**条目（门禁接线 / 规范修订 / 台账与基线治理 / 测试基建），按 §13.10.2 的判据它们**不该进**发布日志；实测全并进去会让 `CHANGELOG.md` 涨到 **2.7 MB / 23k 行**，发布日志随之彻底不可读。归档**是分类，不是丢弃** —— 本轮刻意**没有**替这 1292 份碎片逐条判定「哪条用户可见」（那是主观的、不可核的），它们全部留在归档里。
  - 判据：`tests/dist-artifact-hygiene.test.ts` 与 `tests/standalone-runtime-completeness.test.ts` 钉住新根文件进了产物剔除名单（`scripts/standalone-private-inputs.mjs` 的 `DEV_ARTIFACTS` + `scripts/check-standalone-contents.cjs` 的开发期文件正则）—— 归档**不进桌包**（与 `CHANGELOG.md` 同款，硬规则 17）。

## Changed

- **规范 §13.10.7 新增「碎片是中转站，不是仓库」**：记下「只写不并」这个真实失效形态、本次处置，以及为什么**刻意不给它加判据**（「碎片攒了多久」是时间量，任何阈值都会在「刚整理过」与「长期没人整理」两种状态下给出同样读数 —— 判据活不过一次评审的形状，§11.18.4）。约束落在写入侧：`changelog.d/README.md` 写明「这里每一份都应当能用 `git log` 对上一次最近的改动」，并指向归档文件。
- 原 §13.10.7（ISSUE 号接线）顺延为 §13.10.8，其引用（含 checklist 与生成态 `docs/generated/13-*.md`）同批更新。
- `README.md` 根目录文件用途表新增 `CHANGELOG-archive.md` 一行，`changelog.d/` 那行补上「**只放尚未并入的条目**」。
