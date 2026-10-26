## Added

- **锁编排探针（ISSUE #2363）：先测「平台给不给跨跑串行」，再谈形态**。这条线的诉求是
  「重档在 16 核节点上串行」，而它卡在两件**没测过的事**上：同 key 上第二条流水线到达时
  `cancel-in-progress: false` 到底是排队 / 跳过 / 照样并行，以及平台认不认 **stage 级**
  `lock`（只有它成立才谈得上「只串行重档」）。没有这两格读数，任何配置改动都只是装饰。
  落地三件事，读数取完即整段删掉：
  - `.cnb.yml` 里三条**一次性**探针流水线（`api_trigger_probe_a` / `_b` / `_c`）：
    A = 同 key + `cancel-in-progress: false`，B = stage 级 `lock` + `wait: true`，
    C = 一条锁都不写的**对照**（没有它，前两条的「相交/错开」分不清是锁造成的还是节点
    本来就排队）。三条都**刻意不吃 `*common`** —— 那条锚点自带
    `lock.key: pr-$CNB_PULL_REQUEST_IID`，在 `api_trigger` 上无值，三条会落回同一把字面
    `pr-` 并互相掐停，也就是探针自己成了变量。
  - `scripts/ci-probe-lock-readout.mjs`：起跑（`start` / `pair`）与取数（`report`）的唯一
    入口。取数判的是**时间线**：每跑的 `createTime` / `startTime` / `endTime` 与**逐对**
    的相交秒数 —— 「排队」与「照样并行」在状态字段上根本分不开，只有相交读数能分开。
    终态只认 `data.status` 的原值（与 `scripts/ship.mjs` 同一条红线：平台的 HTTP 200
    与流水线过没过毫无关系）。
  - 判据那半边是**有期限的例外**，不是放宽：`tests/no-platform-ci-config.test.ts` 的
    `PROBE_PIPELINES` / `PROBE_BY` 让那三条各自被点名放过「必须引用 `*common`」与
    「类锁必须 `cancel-in-progress: true`」两条规则 —— 例外名单是字面量、
    **过了 `PROBE_BY`（2026-11-09）当场转红要求删掉**，而三条一旦不在配置里，用例照样绿
    （删探针不留下一条只能靠改用例才能过的判据）。
- **两条当场读数（都来自 `start-build` 的实测回包，不是推演）**，它们直接把「怎么测」
  的形状定死了：
  - `start-build --config` **不能凭空定义一个新事件**。带 `--config` 与把 `config` 塞进
    `--data` 请求体都回同一句
    `[CONFIG_EVENT_EMPTY] … no api_trigger_probe_a event config for branch master and $` ——
    `--config` 只覆盖**被选中的那条流水线**的内容，事件名本身要先在配置里存在。
    所以探针必须写进 `.cnb.yml`（这条也是 `scripts/ci-probe-lock-readout.mjs` 头注里那段
    「为什么必须落配置」的来路）。
  - **stage 级 `lock` 在 schema 里根本没有 `cancel-in-progress`**：官方
    `conf-schema-zh.json` 的 `definitions.lock`（stage / job 共用）只有
    `key` / `wait` / `expires` / `timeout`，那一格只存在于 `definitions.pipelineLock`。
    也就是说「stage 级锁会不会顺手把别的跑掐停」这个问题**在配置面就不成立**，
    能问的只剩「它认不认、认了是不是只串这一格」。
