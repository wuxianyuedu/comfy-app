## Changed

- oxlint `unicorn/prefer-import-meta-properties` 全仓清零：2 处 / 2 份（#2775）。
  `fileURLToPath(new URL(".", import.meta.url))` 换成 `import.meta.dirname`（仓内已有同款先例，
  `engines.node` 是 >=26.12.1，`import.meta.dirname` 从 Node 20.11 起可用）。
  两处都顺带删掉因此不再使用的 `fileURLToPath` import。一处连带修正：`dirname` 不带结尾分隔符
  （`fileURLToPath(new URL(".", …))` 带），用工坊标题结构用例里 `${dir}WorkshopStageBody.tsx`
  的拼接改成 `${dir}/…` —— 那份用例跑过（29 条全绿）。
