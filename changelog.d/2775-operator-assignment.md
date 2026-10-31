## Changed

oxlint `eslint/operator-assignment` 全仓清零（#2775）：3 处 / 2 份。

- `log-store.test.ts` 的 `seq = seq + 10` → `seq += 10`；
- `secrets.test.ts` 两处篡改密文字节：fixer 给的是 `tamperedCt[0] ^= 0xff`，在 `noUncheckedIndexedAccess` 下复合赋值要读 `number | undefined` ⇒ `tsc` 报 TS2532（`Object is possibly 'undefined'`）。改成 `tamperedCt[0] = tamperedCt.at(0)! ^ 0xff`：读侧保留非空断言、写侧仍是同一下标，语义不变；两侧表达式形态不同，规则也不再判。

整条规则 0 命中（2409 份扫描）。`tsc --noEmit`、eslint 通过；受影响用例闭包 91 份（固定 89 + 受影响 2）本地两段都跑绿（89/89、2/2）。
