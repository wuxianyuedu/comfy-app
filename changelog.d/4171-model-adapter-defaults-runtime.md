## Changed

- **模型适配器的「保存为项目默认」不再写 `src/**` 源码文件，改落本机运行时覆盖**
  （ISSUE #4171，#4150 的同族收口）。「模型适配」页点「保存为项目默认」此前把
  用户态写进被 git 跟踪的 `src/lib/workshop/model-adapter-defaults.json` ——
  工作树常挂 M（有被顺手提交进库的风险）、dev 下每次写 src 触发 Turbopack
  模块图失效，与 #4150 修掉的侧栏页签 / 模式契约 / 尺寸配置表同族。
  - 落点：改写 `data/workshop-model-adapter-project-defaults.json`（不入库）；
    src 那份只剩编译进包的默认值（静态 import 不动，改它走代码 / PR）。
  - 读链：先读本机项目默认覆盖，逐模型压过编译快照；覆盖缺档的模型回落编译
    快照（后续 PR 往编译源新增的模型不被本机旧副本遮住）。
  - 存量搬迁：旧版写进 src 的用户态由读侧经共用件
    `defaults-legacy-migration.server` 首次读取时搬去新落点（与编译快照一致的
    pristine 文件不迁移、src 本体不回写）。
  - 文案与登记：按钮与提示改「保存为项目默认（本机）」；`PRIVATE_INPUTS` 与
    「存放位置」清单同批登记；产品规格 FR-LM-05 同步。
  - 回归：`tests/model-adapter-defaults.server.test.ts` 重写（读链 / 生效档 /
    写侧落点 / 存量搬迁四组）。
