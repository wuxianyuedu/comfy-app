## Fixed

- **`pr-gate.yml` 的 test-gates 命中 node_modules 缓存后 pnpm 跳过 postinstall，`tests/storybook-data-sources.test.ts > media 源的名字清单与磁盘上的真文件对得上` 必红（#3748）。**

  #3738 引入的 `node_modules 直缓存（灰度）`让 install 在缓存命中时是 no-op：`.storybook/assets/`（postinstall 现生成、gitignored、不入库）不在 node_modules 里 ⇒ 该判据红而同跑其余 job 全绿，表现为 master 上每个 PR 的质量门禁必红一条判据。

  改法：test-gates 的 `安装依赖` 之后无条件补一次 `node scripts/install-git-hooks.mjs`（与 fresh install 同一落点，幂等）；并把 `storybook-data-sources.test.ts` 的 assets 前置改由自己在 `beforeAll` 现生成，本地增量 install 同形态一并免疫。
