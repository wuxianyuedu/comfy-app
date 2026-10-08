## Added

- **全量 e2e 的「每日自证」**（ISSUE #1282）：`pnpm check:e2e`
  （`scripts/e2e-run.mjs`）跑绿即往 `scripts/.e2e-freshness.json` 记一条凭证，
  pre-commit D 组的 `scripts/e2e-freshness-gate.mjs` 判「当天第一次提交带没带凭证」——
  跑绿或 `--skip "<理由>"` 记一条写明理由的豁免即放行，否则阻断并给出跑法。
  像素档那一边守的是「基线有没有被换掉」，这一边守的是「功能链路上一次绿是什么时候」
  （现场：入库的 linux 档基线被别线的产品改动作废、躺了两天）。
- 跨平台入口：`pnpm check:e2e` / `pnpm check:all --mode e2e` / 双击入口 `-Mode e2e`
  （按需档，不在 `all` 里），登记在 launch-and-build §9.5。

## Changed

- 「新鲜度账」的记录形状 / 三向校验 / 年龄读数下沉到 `scripts/fresh-ledger.mjs`（§12.12）：
  像素档与全量 e2e 档共用同一份内核，各写一份就是孪生对 —— 两张同名的账会给出两种结论。
