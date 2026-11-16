## Fixed

- **GA 每日档「桌面成品构建」红：出厂计数判据按旧路径 spawn**（ISSUE #4037，run
  43775104973 · sha e51e9c4b）。scripts 大迁移（#3930/#3946/#3964/#3978）把
  `check-standalone-contents.cjs` 归入 `scripts/gates/`，而 `build-desktop.mjs`
  仍按旧顶层路径 `scripts/check-standalone-contents.cjs` 起子进程 —— Node 找不到
  入口文件，构建在「static 体积」之后当场退出（exit 1）。
  - 修法：spawn 路径改指 `scripts/gates/check-standalone-contents.cjs`（与
    `package.json` 的 `pnpm build` 链、错误信息里念的路径对齐）。
  - 用例：`build-desktop-step-readings` / `build-desktop-pnpm-cli` /
    `dist-artifact-hygiene` 复跑全绿；下次 GA 每日档桌面成品构建为终验。
