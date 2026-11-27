## Added
- `pnpm publish:bundle [--root <dir>] [--dry-run] [--label <名>] [--keep]`（#5192）：给已有 `publish-desktop-bundle.mjs` 挂上 pnpm 名字，README / 规范里反复手敲的裸命令有了入口；旗标白名单拒绝拼错，参数与退码原样透传，不改发布判据。
