## Added

- **只启动一个 exe：双击 `src-tauri\target\release\app.exe` 现在也能起来了**（ISSUE #784）。以前直接双击壳会加载 `tauri.conf.json` 的静态 `devUrl`（内嵌 Edge 错误页），必须双击 `start-tauri.exe` 才有编排 —— 于是任务栏上两个图标，而「关掉主窗后整棵树能否回收」取决于启动器退出前有没有把 Job Object 句柄交出去。现在壳在同一个进程里承担编排宿主：起 `node scripts/dev-launcher.mjs --mode prebuilt`、把「服务就绪」接到启动页那条现成的链上（`get_launch_status` → `navigate_to_app`），并在退出时回收自己起的编排器整棵树。编排本身仍是 `dev-launcher.mjs` 那一份唯一实现，没有搬进 Rust。

## Changed

- **两个入口并存且不打架**：老入口（`{{shell.exe.prebuilt}}`）起编排前会先查有没有「壳自编排的编排器」在跑，命中就让位并把监控退化成「读进度 + 等窗口出现」；壳起编排前也会避开已在跑的（认亲判据是进程环境块里的 `COMFYAPP_SHELL_OWNED=1`，只有壳写、只有它起的编排器才有，**不按形态猜**——「有没有 dev server」「命令行里有没有项目根」都认不出是谁起的）。回收侧，启动器的兜底补刀遇到壳自编排的编排器会让开（它随壳退出，杀了就是把用户正在用的应用掐掉）。
- **编排起不来时不再把主窗导航到连不上的地址**：自编排失败（缺 `scripts/dev-launcher.mjs` / `node_modules` 不全 / 没有 `node`）只记 WARN 并退回静态 `devUrl` 行为；编排器起来了但服务没就绪时，主窗停在 `about:blank`、启动页保持可见（旧行为是把内嵌错误页顶给用户，看起来像「坏了」）。壳把编排器的 stdout/stderr 原样转发进壳日志，启动页「查看日志」里就是第一现场。
- `scripts/reap-process.mjs` 新增 `--detach`：给「正在退出、等不起 `wait`」的宿主（壳的 `Exit` 事件、启动器收尾）派发即返回，其余场景保持等待（退出码写进日志，落没落可核对）。
