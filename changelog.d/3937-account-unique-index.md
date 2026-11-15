## Fixed

- **`account` 表补 `(providerId, accountId, userId)` 唯一索引**（#3937）：对齐 better-auth
  的外部身份语义——同一用户在同一 provider 下的同一外部账号至多一行。存量重复由
  `scripts/db-unique-sweep.mjs` 清洗（各保留最早一行）后再建索引。
