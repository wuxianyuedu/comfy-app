## Removed

- **`src/trpc/server.ts`（RSC 的 `api` + `HydrateClient` 整条链路）**：`createHydrationHelpers` + `createCaller` + `cache(getQueryClient)` 包出的服务端 tRPC 调用器与水合组件，在 `src/**`、`tests/**`、`scripts/**`、`e2e/**` 里**零引用**（只有 TypeDoc 生成的 `docs/api/**` 提到它，不算消费方）。按规范 §12.15 第三条删除：全库不存在「本应复用它却自己写了一份」的等价实现（不满足接线条件），也没有明确的落地时机 —— 本应用的服务端页面只渲染外壳，数据一律走客户端 `~/trpc/react` / `~/trpc/vanilla`，`src/app/workspace/page.tsx` 更把视图全部 `dynamic(..., { ssr: false })`，RSC 预取在这套「客户端拉取」形态里没有位置，「以后可能用」不构成保留理由。

## Changed

- **零消费导出判据的扫描范围从 `src/lib/**` 扩到地基层（`src/lib/**` + `src/trpc/**`）**：`src/trpc/server.ts` 那条死链路能长期活着，根因就是原判据只扫 `src/lib` —— 客户端入口目录里躺着一条完整死链路，没有任何机器判据管它。实测 `src/trpc` 的 4 个值导出（`createQueryClient` / `api` / `TRPCReactProvider` / `vanillaApi`）**全部有消费方**，纳入扫描**零误报**，因此并入同一份清单（不再另起一份会各自漂移的「trpc 死代码扫描」，见 §18.4「会静默失效的清单只许定义一次」）。基线仍为 34 个，`pnpm` 门禁两态（默认 / `--strict`）均绿；回归测试 `tests/check-dead-exports.test.ts` 由 10 例增至 12 例（新增「`src/trpc` 零消费导出被阻断」「`src/trpc` 被消费导出放行」两组，并用真实仓库断言棘轮无漂移）。
