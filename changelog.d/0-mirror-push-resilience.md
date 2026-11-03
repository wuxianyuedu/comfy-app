## Fixed

- `ci-github-mirror-push.mjs` 对 egress 类间歇抖动加韧性：探活单次上限 15s → 30s 且至多试 3 次（退避 5s / 10s），`git push` 仅对 egress 类失败重试 1 次；认证 / 权限 / 仓库不存在类一律不重试。三态退码与 `--readout` 语义不变，`.cnb.yml` 两格外框随最坏墙钟放宽到 10m。
