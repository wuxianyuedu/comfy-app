## Added
- `pnpm deps:diff [--max-per-section N]`（#5184）：薄包装既有 `lockfile/diff-cli.mjs`，把 `--installed node_modules/.pnpm/lock.yaml --root .` 填死，退码 0/1/2 原样透传，不再手抄易错路径。
