## Fixed

#2919 收口后回潮：`scripts/ci-github-verdict-read.mjs` 的 `parsed?.dispatched` 是
`JSON.parse` 后的外部数据防线（文件内容可以是 `null` / 标量），落
`oxlint-disable-next-line typescript/no-unnecessary-condition` + 理由。
