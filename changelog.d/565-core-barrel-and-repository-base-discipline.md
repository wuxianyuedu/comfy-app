## Changed

- **`core/index.ts` 不再 `export *`**：改为具名转发，并写明「生产代码走深路径」这一实际口径。
  它此前的模块文档写着「所有 server 端模块统一 `import { ... } from "@/lib/core"`」，
  而全库只有 2 处真的这样导入 —— 假承诺的代价是下一个人照着写就多出一种取法（与已删除的
  DI 容器同款）。新增判据：禁 `export *`、转出符号必须有消费方，由
  `tests/core-barrel-entry-discipline.test.ts` 守住，接入 pre-commit 第 23 步与 CI。
- **`repository-base.ts` 去掉基类里的日志**：基类只做「实体 ↔ 表 ↔ 主键」的机械翻译，
  留痕由子类按自己的语义记（如任务状态机在 `repository-task.ts` 记状态迁移）。
  此前那一行 `log.debug("create", …)` 把日志口径钉在基类，并让没有日志设施的宿主
  （测试 / 纯 Node 脚本）连带加载 pino 与写盘镜像。判据见
  `tests/repository-base-purity.test.ts`（禁 import 日志实现与上层依赖）。
- 两处消费方改用深路径：`src/server/api/trpc.ts`、`src/lib/auth-server.ts` 取
  `userRepository` 改从 `@/lib/core/repository`，`src/lib/skills-seed.ts` 的类型改从
  `@/lib/core/repository-skill`。

## Fixed

- 补上 `repository-base` 的 `idColumn` 显式分支用例：此前 `update` 走的那条取值路径
  没有用例覆盖，`repository-base.ts` 行覆盖停在 80%。

## Added

- `src/lib/core/**` 覆盖率门槛随实测值上调：lines 90 → 95、functions 85 → 95
  （statements 90 / branches 90 不动），口径仍是「实测值向下取整到 5 的倍数，只升不降」。

## Docs

- 规范新增 §12.17「出口纪律：barrel 不转假承诺，基类不做横切」，并同步 18.8 / 18.12 速查
  与 `docs/README.md` 索引。
