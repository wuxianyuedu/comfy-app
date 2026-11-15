## Changed

- Turbopack dev 持久缓存从「硬关」改成「默认关 + 显式实验档」（#3943）：`next.config.js` 的那一格改读 `COMFY_TURBOPACK_DEV_CACHE`，**只认 `"1"`** 才打开，其余一律关闭 —— 默认行为与 #3559 收口时逐字一致（整页 reload 回滚循环的上游条件没变，vercel/next.js #100267 仍未修）。改动动机是「首屏现场编译慢」这条反馈需要一个能量化它的口子：先前要试只有「把默认值改回 `true`」一条路，那会让风险落到所有并行分支上、且回滚时没人记得改回去。`scripts/dev.mjs` 在该档打开时念一行 `⚠`（含「看到整页反复重载就先去掉它」），风险档必须被读出来；`tests/next-config-turbopack-cache.test.ts` 从「字面量必须是 false」改成三条一起判：默认关闭、分叉只认字符串 `"1"`、配置里不许出现裸 `true`。
- 规范补 §1.8（`launch-and-build.md`）：「预编译」在本仓只有一条正路 —— `pnpm build` → `pnpm start`（首屏零编译、但无热更新），与开发档的取舍属该形态本身；并说明为什么**不该**去预编译 `.ts`（`tsc` 不产出运行期代码，转出来的 JS 仍要 Turbopack 再编一遍，还要改 `resolveAlias`、处理 `.use client` / `.server.ts` 边界，并撞产物层两道默认拒绝的判据）。
