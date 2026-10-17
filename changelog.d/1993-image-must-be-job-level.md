## Fixed

- **`image:` 从 stage 级挪到 Job 级 —— 上一版让 `浏览器安装` 整格 99ms 就红**
  （ISSUE #1993 续，现场 `cnb-0ka-1k5517hk3`）。上下文里那两格（`浏览器安装` /
  `E2E 关键流程`）把 `image:` / `volumes:` 直接挂在 stage 上，平台当场答：

  ```
  失败 Stage: 浏览器安装 (status: error)
  错误信息: Runner does not enable Docker.
  耗时: 99ms
  ```

  两层语义不是一件事：**Job 级** `image:` 是「指定 `image` 的脚本任务在独立容器中执行」
  （平台为这一个任务起一个容器，自托管上可用）；**stage 级** `image:` 是「当前 Stage 下
  的所有任务默认都在这个镜像环境中执行」—— 那是给整条流水线换构建环境，正是自托管
  Runner 不具备的能力。所以写错**层**不是「不生效」，是整格起不来。

  改法：两格各自拆成 `- name: <stage 名>` + `jobs:` + 一个同名 Job，`image:` /
  `volumes:` / `env:` / `timeout` 一起下移到 Job 那一层（一个容器的镜像、挂载、变量、
  预算说的是同一件事）。stage 名不变 —— 判据与账里一直用外层那个。

## Added

- **`stageLevelImages()`：写错层的那一格现在有人点名了**（
  `scripts/ci-container-plan.mjs`）。此前「写在哪一层」没有任何执行者，而它的形态恰好是
  「配置看着完全正常」。`tests/ci-container-plan.test.ts` 要求现役 `.cnb.yml` 里它**为空**，
  并要求读数把这一行排在**最前**（整格起不来比「桥通不通」更重）。

- **解析器与判据跟着改口径**：`platformImageStages()` / `containerStages()` / `describePlan()`
  只认 Job 级 `image:`；`stageTimeouts()` 认子 Job 那一层（Job 级的容器格里预算跟着
  `image` 下移），Stage 列表项的缩进也从写死两格改成按原文计（`^ {n}` 那一族正则在这台机
  的 V8 上会漏回溯，本仓已有多处记着）。

## Docs

- **规范 §13.5.3.4.1.3 新增一段反例**：「`image:` 写在 stage 上，整格 99ms 就红」——
  两层语义的对照表 + 本仓那两格的标准形态（stage 拆一层）。§13.5.3.4.1.4 与
  `docs/guides/ci-node-image.md` 里「任务级 `image:`」的说法一并对齐成「Job 级」。
