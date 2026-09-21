## Fixed

- **`comfyui/lifecycle.test.ts` 的 6 个「期望未运行」用例环境相关地红（非随机 flaky，是不 hermetic 的测试）**：根因是 `./status` 的 `getComfyRuntimeSnapshot` 直接从 `./probe` 导入 `probeComfyAtPort`（不经 `./client`），而测试只 mock 了 `./client` 的探针——于是快照路径**真去探本机端口**，机器上跑着 ComfyUI（或残留实例）时快照报 `running`、`getComfyUiStatus` 的 `up` 变 `true`，「未启动任何流程时 up 应为 false」等 6 个用例就红；CI 上没有 ComfyUI 才恰好绿。补 `vi.mock("./probe")`（默认探不通）把这条真实探测桩掉，快照路径变 hermetic，与本机状态无关。24 用例（23 passed / 1 skipped）稳定全绿；`up:true` 类用例仍经 `./client` 的探针 mock 得结论，不受影响。
