## Fixed

- **`workflow.list` 每趟请求都同步递归扫描本地工作流根目录（`src/lib/comfyui/localWorkflows.ts`）**：
  扫描用 `readdirSync` + 逐条 `statSync` 递归整棵树，同步 fs 会把整段扫描时间堵在
  Node 事件循环上 —— 根目录挂到 ComfyUI 安装目录时条目量可达数千，一次扫描就把同时
  进来的所有请求一起卡住。改为异步 `fs.promises`：目录递归与候选文件的 stat 都不再
  阻塞事件循环，并用 `readdir(dir, { withFileTypes: true })` 的 `Dirent` 判类型，
  连非 `.json` / `.workflow` 的条目也不必 stat（同步版对每个条目都 stat 一次）；
  文件 stat 按 32 并发分批、根目录之间并发。
  **没有**改用「缓存扫描结果」这条捷径：清单里的 `mtimeMs` 会被调用方当作
  「磁盘文件有没有变」的判据（`workflow.ts` 建 `diskMtimeByPath`），缓存会让
  「只改文件内容、不改目录 mtime」的情况读到过期的 mtime。
