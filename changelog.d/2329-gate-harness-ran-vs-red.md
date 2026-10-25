## Fixed

`tests/test-waitfor-gate.test.ts` 的夹具把三件不同的事实折成一个 `ok: boolean`，于是
**红的时候读不出原因**（ISSUE #2329）。当场现场：PR #2327 那一跑（`cnb-5p5-1k5oeragv`）
红在 `:131` 的 `expect(r.ok).toBe(true)`，消息位是空的，唯一带事实的
`expect(r.output)` 排在它后面一行、永远轮不到 —— 整份 stage 日志里
`ENOBUFS` / `maxBuffer` / `spawn` 命中 0 处，事后连定性都做不了。

- `gate()` 现在交出**五件原值**：`ran / status / code / signal / output`，`output` 一律是
  两条流拼一起（#2287 的口径）。分类按事实，不按退出码：
  **node 报 `Cannot find module` 退的也是 1**，与「判据判出越界」逐字同码 ⇒
  只看 `status` 必然误判（这句 `scripts/base-check.mjs` 早就写过，本文件这次把它钉成用例）。
- 新增 `expectRan(r)`：`ran === false` 时**先**判掉，消息里带 `status` / `code` / `signal`
  与两条流原话，并明写「这一格不构成判决，不是判据红」—— 口径同 §13.6.4
  「拿不到测量 ≠ 测量结果是红的」。
- 五处原断言改成 `expectRan(r)` + `expect(r.status, r.output).toBe(0 | 1)`。
- 正反两格新增（防「为了少响把两边一起判掉」）：
  ① 脚本取不到 ⇒ `status` 仍是 1，但 `ran=false`、`output` 含 `Cannot find module`、
  `code`/`signal` 自证「不是 spawn 失败、也不是被信号杀」；
  ② 真判红那一侧 `ran=true` 且 `status=1` —— 两格没被同一条规则吞掉。实测该文件 **8 passed**。
- **没有新增门禁**（§12.20），也**没有批量回填**：同族夹具（`execFileSync` + `ok: false`）
  在 `tests/**` 还有 21 份，按「改哪张单顺手补哪张」处理 —— 本笔只动今天真正读不出原因的那一份，
  21 这个存量数字记在 #2329 的评论里。
