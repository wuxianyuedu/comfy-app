## Added
- `pnpm check:standalone`（#5194）：给 `check-standalone-contents.cjs` 挂上 pnpm 名字，与 `check:bundle` 同族。改完构建 / 产物相关的东西不再手敲裸 `node scripts/...`；旗标与退码原样透传，不另写判据、不改两层 × 两个方向的扫描面。
