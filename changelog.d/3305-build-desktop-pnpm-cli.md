## Fixed

- **GA 桌包档「桌面成品构建」红在 `beforeBuildCommand` 第一步 `pnpm build`**（ISSUE #3305）：
  `pnpm/action-setup@v6` 只把 `<dest>/node_modules/.bin` 加进 PATH，npm 在 Windows 给那里
  摆的是 `pnpm` / `pnpm.cmd` / `pnpm.ps1` 三个垫片 —— Node 的 `spawnSync({shell:false})`
  起不来，而 `build-desktop.mjs` 是仓里唯一还在 `beforeBuildCommand` 的 Node 子进程里
  用 `pnpmInvocation()` 按名字找 pnpm 的消费点 ⇒ 返回 null ⇒ 整格 1 秒红、artifact 与
  nightly 全 skipped。CNB 同款档能全绿，靠的是安装格 `ci-install-deps.mjs` 把 pnpm 真身
  放回 PATH，而 GA 侧当初把整格当「缓存槽空转」省掉了。
- 修法两件同批，都是复用既有判据、不重造第二套「怎么找 pnpm」（§12.18 / 硬规则 24）：
  ① `package-desktop.yml` 新增一格，取 `pnpm/action-setup` 的 `bin_dest` 输出、把 pnpm 12
  原生 `pnpm.exe` 所在的 `<dest>/node_modules/pnpm` 目录追加到 `GITHUB_PATH`（补的是真身
  目录、不是垫片目录，pwsh 与 Node 两条解析面都够得着）；
  ② `build-desktop.mjs` 两处（1/4 `pnpm build` / DDL 导出）从 `pnpmInvocation()` 收口到
  `ci-install-deps.mjs` 的 `pnpmCli()`，与 daily 生产构建 / db-push / db-migrate /
  e2e-run / full-suite-run 同一份判据；顺手把 `pnpmCli` 的 JSDoc 注入面补全为
  `ensurePnpmOnPath` 的全量形状（纯声明对齐，行为未改）。
- `tests/build-desktop-pnpm-cli.test.ts`（3 条）：钉源码形态不许回潮；用注入面证明
  「纯垫片」形态下按名字找返回 null 而 `pnpmCli` 不硬 fail；证明补 PATH 后 `pnpmCli`
  命中 `pnpm.exe` 绝对路径（这是修复能成立的决定性证据，不依赖 Windows spawn 假设）。
