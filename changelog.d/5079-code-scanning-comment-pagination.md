## Fixed

- **code scanning triage 的评论回读改为翻页找 marker（#5079 / mirror #18）**：此前
  `appendComment()` 只回读 `issues/{n}/comments?page=1&page_size=20`，而 CNB 评论默认
  按 `created` 升序、新评论在末页；规则单每天追加一条读数，很快过 20 条后「写成了」
  被永久误判成「没写成」并让 job 红。现逐页翻到命中为止（page_size 沿用 100 常量，
  MAX_PAGES 上限防无限翻），翻完仍没找到才算失败；回读列表取不到仍明确报
  「不拿回执当结论」。同批补 3 条用例：marker 在第 2 页算写成、翻完没有才算失败、回读失败不冒充结论。
