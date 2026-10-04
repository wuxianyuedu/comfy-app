## Removed

- **炼丹（训练）功能删除后的残留全部清掉**：上一次只删了组件与入口，后端链路、
  死设置、孤儿快照与失效注释都还挂着：

  - `LoraTrainingJob` 仓储与数据表：删 `src/lib/core/repository-lora.ts`、
    `~/server/db/schema` 的 `loraTrainingJob` 表与 `LoraTrainingJob*` 类型、
    barrel 里的 `export * from "./repository-lora"`、`tests/helpers/test-db.ts`
    的建表 SQL 与表名清单，以及 `repository.test.ts` 的一整组用例。
  - `ModelRepository.registerLora`：只在炼丹产出口上被调用过，随功能一起删；
    同组的 `countsByFolder` 用例改写成只测自己（原先把两条断言捆在一个 `it` 里，
    删一半会连带丢掉另一条）。
  - 两项只服务炼丹的设置项 `trainerUrl` / `comfyLorasDir`：类型 / 默认值 /
    设置页字段 / `setting.save` 输入 / 各自用例整链删除（`comfyLorasDir` 除界面
    外零消费、`trainerUrl` 的协议白名单用例是它唯一的执行者）。
  - 孤儿快照 `src/components/studio/__snapshots__/TrainingStudio.test.tsx.snap`
    （被测文件早已不存在）与 4 份属于该功能的 `changelog.d/` 碎片
    （`0-trainer-typed-job-spec` / `0-train-upload-partial-keep` /
    `0-training-studio-snapshot` / `0-film-lora-log-bounded`）。

## Fixed

- **`e2e/critical-flows.spec.ts` 的 `@critical 工作区首页渲染主干入口与最近项目`
  基线红**：「侧栏主干入口」名单里还列着已删的「炼丹」导航项，从功能删除那天起
  就一直是红的。改为与 `NavItems.tsx` 的 `globalNavItems()` 实况一致
  （首页 / 模型 / 历史 / 队列 / 流程）。
- 清掉一批指向已删文件的注释与脚本说明里的引用（`TrainingStudio` /
  `use-training-studio` / `lib/comfyui/trainer.ts` / `core/repository-lora` /
  `setting.trainerUrl`），只在需要留住「这条例矩为何存在」的地方标为历史形态账。
