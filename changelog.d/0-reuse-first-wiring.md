## Changed

- **按 §12.18「复用优先」接线：把 4 类「家已存在、新代码没去用」的重复收口**（普查核实，逐处确认等价后替换，每类一个 commit）：
  - **#3 sleep**：6 处内联 `new Promise(r=>setTimeout(r,ms))` + `orchestrator` 局部 `sleep` → `~/lib/with-timeout` 的 `sleep()`（逐字等价、该模块零 import 客户端安全）；`lifecycle-wait.ts` 的 `sleep` 是**故意的可注入测试桩**，保留不动。
  - **#2 ComfyUI base URL**：`instance-port` / `lifecycle-derive` / `lifecycle-launch` 三处手拼 `http://127.0.0.1:${port}` → `comfyUiBaseUrl(port)`；`executor-cli` 两处硬编码 `"127.0.0.1"` → `LOOPBACK_HOST`。
  - **#4 tRPC getBaseUrl 逐字孪生**：`vanilla.ts` 与 `react.tsx` 各一份相同 `getBaseUrl` → 抽 `src/trpc/base-url.ts` 一份；顺带 `localhost`→`127.0.0.1`（dev server 绑 `-H 127.0.0.1`，SSR 侧 Node fetch 把 localhost 解析成 `::1` 会 ECONNREFUSED，§12.14 同一判据）。
  - **#7 Ollama 探测 URL**：`ollama-start`/`ollama-stop` 两处手拼 `http://127.0.0.1:${OLLAMA_PORT}/api/version` → 新增 `endpoints.ts` 的 `ollamaBaseUrl(port)`（与 `comfyUiBaseUrl` 同形态）。
- **普查另列 #5 字节、#6 日期时钟两类，经逐处核实判定为「非违规」不动**：#5 已在用共享的 `fixed()`、只是刻意保留 1 位小数（`fmtBytes` 对 MB 用 0 位且小文件降 KB，换了丢精度）；#6 的 `clockOf`/`nowTimeStr` 注释明写「手写格式化避免 locale 影响断言」、产 `HH:mm:ss`/`HH:mm`，而家函数 `formatClock` 走 `toLocaleTimeString("zh-CN")` 格式/秒位/locale 都可能不同，换了会改输出并撞断言。这正是 §12.18「确认是这一处独有的需求才就地写」的判断，不是漏改。
