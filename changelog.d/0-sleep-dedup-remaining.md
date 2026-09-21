## Changed

- **按 §12.18 收口剩余内联 sleep**：上一批 #3 只迁了 6 处，本轮补齐生产代码里剩下的 7 处 `await new Promise((r) => setTimeout(r, ms))` → `~/lib/with-timeout` 的 `sleep(ms)`：`use-settings-page`（Ollama 启动轮询）、`ollama-stop/route`、`VideoStudio`、`drizzle-studio/lifecycle`、`llm/video-task-util`、`server/workshop/comfyui`、`comfyui/lifecycle`。至此生产代码内联 sleep 归零（`lifecycle-wait.ts` 的 `sleep` 是**故意的可注入测试桩**，保留）。sleep 与内联逐字等价、行为不变。tsc + eslint 通过；受影响测试中 `use-settings-page`/`video-task-util`/`drizzle-studio` 全过（`comfyui/lifecycle.test.ts` 的 6 个失败经核实为**既有 flaky**——干净 master 上同样失败，依赖真实 setTimeout 时序、与本次改动无关）。
