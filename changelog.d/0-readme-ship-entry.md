## Added

- **README「常用脚本」那块补上 `pnpm ship`** —— 补的是**入口 discoverability 这一格**。
  驱动器本体随 PR #2034 进了主干（`scripts/ship.mjs` + `scripts/ship-core.mjs` +
  `.qoder/skills/ship/SKILL.md`），但 README 里没有它：而本仓对「入口怎么被人发现」
  早就定了口径 —— **由 README 的入口清单承担，不靠铺在根目录第一眼看见**
  （R9 的注释写在案，`scripts/check-ps1-consistency.mjs` 也真按 README / `tools/README.md`
  两张表核对入口）。也就是说这条承诺此前**只覆盖了 `.ps1` 双击入口**，
  一个跨平台的 `pnpm` 动作落在它外面 —— 于是出现了「功能在主干上、没人知道有」的形态。
  放在 `pnpm check` 之后：本地自查 → 交出去，就是实际的使用顺序。
- **顺带把四条边界写在它旁边**，而不是只写一行命令 —— 因为这个工具的失效形态
  恰好是「看起来成功了」：
  ① 退出码三态，**`2` 是「有一步没跑起来」，不等于通过**；
  ② 默认不合并，要显式 `--merge`；
  ③ 不代写提交信息、不替你 `git add -A`；
  ④ **提交段「全过」不等于 tsc / eslint / 用例过了** —— `pre-commit` 默认只跑形态档
  （ISSUE #2022 / 规范 §13.5.25），本地要全套加 `COMFY_HEAVY_GATES=1`。
  第 ④ 条是这一版新加的事实：#2022 之前它与「全套过了」确实等价，所以当时不写没问题；
  现在不写就会让人把一个「只测了形态」的绿灯读成「测过了」。

## 验证

- `pnpm doc:check` 过（README 属 `SCOPED_DOCS`；它核「文档里出现的 `pnpm <脚本>` 在
  `package.json` 里真实存在」这一向 —— `ship` 已注册，另两条硬规则 1 的 npm 形态检查照过）。
- 只动 `README.md` 一份文件，未跑 prettier（`.md` 没有判据兜底，整文件重排会带出别人的改动）。
- 驱动器侧无变化：`tests/ship.test.ts` 34 passed 不变。
