## Fixed

- **`/api/custom-nodes` 的 `discover` 在请求里同步起 Python（`src/app/api/custom-nodes/route.ts`）**：
  它用 `spawnSync(python, parse_custom_nodes.py …)` 扫描父目录，且最多串行试三个解释器
  （`python3` / `python` / `py`）。`spawnSync` 会把整个 Node 事件循环连同**所有并发请求**
  一起堵住，而这一步正是本路由最慢的一段（扫完目录还要算一遍 hash，目录大时能到分钟级）。
  改为异步 `spawn` + Promise 收集输出（新增 `spawnCapture`），并给单个进程加 60s 上限：
  启动失败 / 非零退出 / 超时都换下一个解释器，最后仍失败则返回空列表（与旧行为一致）。
