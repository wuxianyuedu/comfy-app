## Fixed

- 类锁判据 R2 与 #3924 的按 sha 分锁互相矛盾（#3964）：`lock_ga_verdict` 的
  `key: ga-verdict-$CNB_COMMIT` 被判「带变量」，但该锁只服务 GA 判决回调（push 事件），
  `CNB_COMMIT` 在那条 build 上恒有值（.cnb.yml 锁块头注记了实测 sha_check=match），
  退化的前提不成立。给 R2 加显式豁免（仅这一个 key），其余变量 key 照旧判红；
  若评审认为该改锁而非改判据，在 #3964 里说——两种调和都只动一处。
