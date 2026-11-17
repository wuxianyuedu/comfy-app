## Changed

- **运行期「保存为项目默认」不再写 `src/**` 源码文件，改落本机运行时目录（ISSUE #4150）**。
  三族「项目默认」（侧栏页签 / 工坊模式契约 / 尺寸配置表）的 defaults JSON 既是静态
  import 的**编译进包默认值源**，又被当成运行时可写存储 —— 两个职责挤在同一份被
  git 跟踪的文件里：工作树常挂 M（有被顺手提交进库的风险），dev 下每次写 src 都
  触发 Turbopack 模块图失效（服务端模块的内存态随旧实例变孤儿，#4140 / #4146）。
  现按族拆开：
  - src 那份**只剩编译期默认值**（静态 import 原样保留，分发形态不变、运行期不写）；
  - 「保存为项目默认」（仍只开发检出可用）改写本机运行时覆盖
    （`data/sidebar-tab-project-defaults.json` / `data/workshop-mode-contract-project-defaults.json` /
    `data/size-preset-project-defaults.json`，不入库，写完即生效、重启与重构建都保留）；
  - 读链收口为「先本机覆盖、缺省回落编译快照」，运行期不再读 / 写 src；
  - 存量搬迁：旧版写进 src 的用户态（内容 ≠ 编译快照时）在读链上自动搬去新落点
    （唯一实现 `src/lib/core/defaults-legacy-migration.server.ts`，与快照一致不迁移、
    失败按未迁移处理不阻断读取；src 文件本体不回写，遗留的工作树 M 由人
    `git checkout --` 收掉）；
  - 三份新 data 文件同批登记 `standalone-private-inputs.mjs` 的 `PRIVATE_INPUTS`
    （造包者机器的本机基线不随包）；
  - UI 与文档文案随语义同步（按钮「保存为项目默认（本机）」、数据落点面板、
    产品需求文档的落点与验收口径）。

  要改出厂默认（进出厂包）改 src 那份编译源走 PR —— 「跟代码走」的那条路收归
  代码流程，UI 的显式动作只落本机。
