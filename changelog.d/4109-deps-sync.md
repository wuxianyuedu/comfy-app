## Fixed

- **依赖同步收口为 `pnpm deps:sync` 一条命令，并清掉陈旧的 `.next/types`（#4109）**：本机 node_modules 与 lock 不一致（缺 `@storybook/nextjs-vite`）时 tsc/lint 报 190+ stories 错误、ship 阶段 0 直接退出，原出口是 `pnpm deps:guard && pnpm install` 两句话术；重装后 `.next/types/validator.ts` 仍 import 已删路由（`src/app/login/page.tsx`），拿旧生成物报 TS2307 / TS2344。新增 `deps:sync`（守卫 → `pnpm install --frozen-lockfile` → 清 `.next/types`）一处收口，`scripts/next-types-clean.mjs` 只删类型生成物、保留编译缓存（带回归用例）；ship 漂移话术与 `docs/guides/sync-after-pull.md` 同步更新。
