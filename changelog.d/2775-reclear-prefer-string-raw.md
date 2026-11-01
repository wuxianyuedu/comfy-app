## Changed

- oxlint `unicorn/prefer-string-raw` 补齐全仓面（#2892）：222 处 / 66 份。
  上一轮「全仓清零」只覆盖 `src/**`，本次残留全部在 `tests/**`（174 处）、
  `scripts/**`（43 处）与 `vitest.config.ts`（5 处）；`src/proxy.ts` 仍按预设的
  逐文件 override 关掉（`matcher` 正则）。转义密集的字面量改写为
  `String.raw` 模板。
- 等价性用 TS 解析器逐份比对，不靠肉眼看：把每份文件改前 / 改后解析出的**全部**
  字符串字面量取值收成多重集比较（`String.raw` 取模板的 `rawText`，普通模板取
  cooked），66 份**全部相等**；另查过没有任何 `String.raw` 模板里出现未转义的
  `${`（那会从字面量变成插值）。
