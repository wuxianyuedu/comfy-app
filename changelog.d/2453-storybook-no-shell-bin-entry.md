## Fixed

- `scripts/storybook.mjs`：起 storybook 不再经 shell 层起 `.cmd` 垫片（ISSUE #2453，
  与 #2445 同族）—— Node 26 的 DEP0190 弃用（args 数组 + 开 shell）与「参数要自己括
  引号」两件事一起消失，改为 `spawnSync(process.execPath, [包真身入口, …])` 直起。
  实测 `pnpm storybook`（dev）照旧起到 webpack 编译阶段。
- **入口解析收成一份**（`scripts/package-bin-entry.mjs` 新增）：`resolvePackageBinEntry()`
  是「本地 CLI 的 JS 入口在哪」的唯一实现（`createRequire` → `require.resolve("<pkg>/package.json")`
  → `bin` 字段，字符串与对象两种形状都接得住）。此前 `resolveVitestEntry` 与 #2445 新写的
  `resolveTypedocEntry` 是同算法两份副本，加 storybook 就是第三份 —— 抄一份的漂移形态是
  「换安装方式后其中一份指到空气上，另外两份还绿」（§12.12 / §12.18）。

## Added

- `scripts/spawn-shell-scan.mjs` + `tests/spawn-shell-scan.test.ts`：守「起子进程不许开
  shell」这一条。`scripts/**` 下剥掉注释之后不许出现「`shell:` 且值不是显式关掉」的形状；
  用例进 `scripts/fixed-structural-tests.mjs` 固定清单 —— 改某个脚本加一句 `shell: true`
  **不会**把它带进受影响集，不固定跑就是「第三处靠肉眼发现」（#2445 修完 typedoc 之后，
  storybook 那一处正是这么找到的）。
  判据自身踩过的两个坑也写进了代码注释：剥注释的**整文件状态机**会被一处游离引号卡住
  跑飞（改逐行 + 跨行块注释跟踪）；否定预查里的 `\s*` 放在预查**外面**会因回溯而失效
  （`shell: false` 排不掉），必须放进预查里面。
