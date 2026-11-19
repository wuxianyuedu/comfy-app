## Fixed

- 「已清零 oxlint 规则集」判据（`scripts/check-oxlint-zero-rules.mjs`）在 Windows 上
  第一次真正跑通并判到 0 命中（#3079）。此前它在本机死在三层、每层都把「没跑起来」
  顶到 pre-push 拦 push：① `spawnSync(.bin/oxlint.cmd, { shell: true })` 撞 DEP0190
  硬闸 ⇒ 改 `resolveBinEntryByName("oxlint")` 直起包真身（#2572 同一条路）；
  ② 探针 extends 预设把整组 `jsPlugins`（`@nkzw/eslint-plugin` 那批）拖进来，而
  oxlint 按配置文件位置解析 specifier，pnpm 隔离布局下顶层没有链接 ⇒ 恒「配置加载
  失败」⇒ 探针不 extends 预设（categories 全关后 extends 不带来任何在场诊断，
  等价化简），清单内唯一非内建 namespace 的 `perfectionist` 由判据按**绝对路径**
  显式挂上（解析基准取预设真身位置，那是插件作为其直接依赖的唯一可达层）；
  ③ 跑通后显形 57 处存量：49 处由 oxlint `--fix` 按 fixer 权威形态清零
  （44 处 `no-confusing-void-expression` 箭头块体化等），8 处 `eqeqeq` 是
  `oxlint-disable-next-line` 与 `!=` 之间隔了一行 `/* SAFETY */` 注释 ⇒ 指令只禁
  物理下一行而失效 —— 交换两行顺序让指令紧贴目标。修复后
  `tests/check-oxlint-zero-rules.test.ts` 的全仓正控回绿（此前 12/13 处红）。
