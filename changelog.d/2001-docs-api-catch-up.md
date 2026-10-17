## Fixed

- **`docs/api/variables/server_api_routers_model.modelRouter.html` 落后于源**：
  `src/server/api/routers/model.ts` 的签名改过而生成物没跟着重生成，这一档此前只报
  「修法：`pnpm run docs` 后一并提交」。本次按新增的 `--check --autofix` 档重生成后一并提交
  （ISSUE #2001）。
