## Removed

- **炼丹（训练）功能删除后的残留（第二轮）**：上一轮（ISSUE #1450）删的是代码本体，
  这一轮清的是**到处仍在引用已删件的失效指路** —— 它们全都能编译、全都能过门禁，
  错的是「读它的人得到的事实」：注释与文档里那些名字指向的文件 / 表 / procedure
  早就不在仓库里了（规范 §12.4.2：指路必须为真，历史归 `git log`）。

  - **源码注释**：`ui/form-field` 的「15 处表单行」表里那行已删的训练工作室、
    `ui/use-interval` 的「不立刻跑一次」族、`ui/use-item-errors` 的「一屏多条目」
    族、`lib/async-action` 的反馈通道清单 —— 都把 `use-training-studio` /
    `TrainingStudio` 当成还在的落点；`lib/core/repository-workflow-template` 与
    `lib/llm/remote-model-schema` 里对 `train.cancel` / `validateTrainForm` 的
    引用改为不带失效名字的同义表述。
  - **脚本落点表**：`scripts/file-structure-rules.cjs`（`lib` 顶层单例的消费方
    清单）、`scripts/ui-primitives-scope.cjs`、`scripts/check-ui-primitives.cjs`、
    `scripts/fixed-structural-tests.mjs` 里点名的已删消费方 / 事故实例，
    改为只留「为什么这条例矩存在」的形态账、并标清已删。
  - **规范与指南**：`docs/standards/16`（§16.2.4.21 / §16.2.4.26 等落点表）、
    `docs/standards/17`（§17.6.1 的 P2 落地记录）、`docs/standards/03` /
    `docs/standards/11`、`docs/guides/PRODUCTION-GAPS.md` 里指向已删文件
    （`TrainingStudio.tsx` / `training-studio-config.ts` / `repository-lora.ts`）
    的**当前**证据与落点，改写为形态账或删去；`docs/generated/**` 同步重渲染。
  - `tests/ui-primitives-coverage.test.ts` 的落点描述里那处「训练工作室超参」删去。

  刻意**不动**的两类：`changelog.d/**` 与 `docs/audits/**`（发布说明与带日期的
  审计快照，本身就是历史台账）；以及标准文档里以 `~~删除线~~` 或「当时」明确
  标成收口前实情的形态账（它们回答的是「这条例矩为何存在」，正是 §12.4.2 要求
  留住的部分）。
