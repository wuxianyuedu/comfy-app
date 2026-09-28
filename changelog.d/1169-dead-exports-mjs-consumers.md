## Fixed

- **零消费导出门禁（§12.16）此前看不见 `.mjs` / `.cjs` 里的消费方**，会把「只有纯 Node 宿主在用」的地基层导出误判成死代码。`scripts/check-dead-exports.cjs` 的文件遍历只收 `.ts` / `.tsx`，而 `USAGE_ROOTS` 里的 `scripts/` 全是 `.mjs` / `.cjs` —— 判据与文件头那句「值导出在 `src/**`、`scripts/**`、`e2e/**` 里零引用」相反（§12.17：注释与判据相反时，下一个人照注释写只会多一条不生效的口径）。触发点：3-E1 新增的 `src/lib/comfyui/host-runtime.ts` 导出 `createHostRepo`，唯一消费方是 `scripts/executor-host.mjs` 的动态 `import()`，门禁报「新增 1 个零消费导出」。
  - 修法是把消费方语料补齐（`walk` 收 `.ts|.tsx|.mjs|.cjs`），**不是**把它登记进基线——基线是「承认留着一份没有消费方的抽象」，而这里恰恰有。登记项反向核对的行为不变，`src/lib` / `src/trpc` 下当前没有 `.mjs` / `.cjs`，声明侧扫描范围不受影响（实测：基线 0 个、当前 0 个，扫描 253 个模块）。
  - 回归：`tests/check-dead-exports.test.ts` 新增「只被 `scripts` 下的 `.mjs` 消费也算消费」一条（把 `walk` 的后缀过滤改回旧写法，该条即红 = 反向自证）。
