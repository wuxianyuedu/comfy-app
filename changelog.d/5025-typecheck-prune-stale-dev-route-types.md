## Fixed

- **typecheck 前按需清理陈旧的 dev 路由类型**（#5025）：删掉路由文件后，`.next/dev/types/validator.ts`（Next dev 生成的全路由类型清单）要等下一次 dev 编译才重生，中间任何一次 `tsc --noEmit` 都会撞出指向已删路由的幽灵 `TS2307`（像「漏删干净」，实际源码早已没有这条引用）。`pnpm typecheck` / `pnpm check` 现在先跑 `scripts/next-types-clean.mjs` 的 dev 侧体检：清单里只要出现「指向 `src/**` 已不存在路由」的引用，就整目录清掉 `.next/dev/types`（下次 dev 按当前路由重生）；清单与磁盘一致时不动（不打扰常驻 dev server）。脚本 best-effort，任何失败都不挡 typecheck；手动 `rm -rf .next/dev` 的出口随之退役。
