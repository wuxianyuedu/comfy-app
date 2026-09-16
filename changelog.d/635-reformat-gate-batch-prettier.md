## Fixed

- 「格式化提交与行为改动分离」门禁（`scripts/check-reformat-only.cjs`）不再对**每个文件各起一次
  prettier**：所有待判文件合并成一次 `prettier --write <临时目录>`，回读结果后再逐文件比对。
  prettier 的启动与插件加载是主要成本（实测单文件约 400ms，与文件大小几乎无关），逐文件调用在
  改动文件数上线性叠加——12 个文件约 5s，真人「批量格式化」改几十个文件只会更慢。CI 上表现为
  `tests/check-reformat-only.test.ts` 与 `tests/check-format.test.ts` 的用例被 vitest 默认 5s
  testTimeout 击穿（`Test timed out in 5000ms`），看起来像「测试写得慢」，实际是门禁自身的调用
  形态把每条用例都推到超时边缘。
- 判据逐字不变：临时目录里保持原文件的**相对路径**（prettier 按路径选 parser），未被 prettier
  改写或不在其视野内的文件退回逐文件 stdin 兜底，兜底也拿不到结论时仍按「真实改动」保守放行。
  「没被改写」必须**回落到 stdin 口径再判一次**才算结论：prettier 的忽略规则（以 cwd 为根读
  `.gitignore`）会让被忽略路径下的文件连显式点名都跳过，于是「本来就规范」与「被跳过」在批量
  结果里长得一样，只有后者能推出「这次提交不是纯格式化」——漏掉它，落在忽略路径下的纯格式化
  提交会被放行（真实先例：`.workbuddy/skills/build-guard/guard.js` 在 #619 的合并提交里落成
  「纯格式化」）。判据因此不改口径、只补证据，`tests/check-reformat-only.test.ts` 新用例反向
  验证过：拿掉兜底即失败。
- 临时目录里的副本在写入前把换行符归一成 LF：副本保持 CRLF 时 prettier 会改写每一个 CRLF
  文件，等于把刚收敛掉的逐文件开销又放回来，也让「由谁给答案」随行尾漂移。
- 上述两个门禁的自检用例放宽整文件 `testTimeout`：每条用例都要真跑 git（init / add / commit /
  merge）并起 prettier，CI 全量并行满载时默认 5s 会被击穿（`tests/check-format.test.ts` 的
  18 条用例每条 300~550ms，顶着上限跑是那次 CI 红的现场）。
