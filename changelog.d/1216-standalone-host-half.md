## Added

- **桌包（standalone 形态）现在会按 `COMFY_EXECUTOR` 拉起 ComfyUI 执行宿主，ISSUE #1216 收口**（P3 §5 · Phase 3-E2b）。3-E2a 把 standalone 接通到「双击进应用」，但运行入口只管 `server.js`；这一刀补上另一半：入口起完 server 之后按 `resolveExecutorMode()` 决定要不要再带一个宿主进程，宿主与 server 因此是**同父兄弟**（都是壳的孙子），不是 Next 进程 fork 出来的——那正是 Phase 4-B3 才卸掉的耦合（宿主与 server 同生死）。退出时收**两棵树**，顺序是先宿主后 server（先停「还会往外发任务」的那一侧）。
  - **开关的来源只有壳进程继承的环境变量**：判据不另写一份（`scripts/launcher-core/executor-mode.mjs` 是 ADR §14 D5 收口过的唯一定义，`" host "` 这类值同样被归一化），桌包里也不新增文件开关或库开关——多一个来源就是多一处会与人对不上的判决。
  - **宿主与 server 共用同一份运行期 env 装配**（绝对 `DATABASE_URL`、密钥、`SKIP_ENV_VALIDATION`），只覆盖两项：归一化后的 `COMFY_EXECUTOR` 与 `COMFYAPP_HOST_BOOT_ID`。boot id 与两份日志的文件名取**同一个** stamp（入口算一次传下去）——否则「按 boot id 跨进程 grep」这条既有能力在桌包里就断了，而这种错配只在日志里看得见。
  - **宿主退出既不降级也不重启**：入口打一行 `host exited code=…` 并指到它自己的 stderr，server 继续跑，任务留在队列（#1204 之后的既定语义）。降级会让已经写成 host 归属的行没人领，重启会把「起不来的宿主」掩盖成「慢」。
  - 判据三行按序（壳日志）：`executor mode=host` → `host pid=… out=… err=…` → 宿主自己那份 `log/services/` 里的 `boot pid=` / `runtime inject-ok`。缺哪一行就断在哪一层；README 与[执行器宿主指南](../docs/guide-executor-host.md)的桌包段按此放开为「可用但仍属灰度」（不写开关 = inline，与灰度前逐字相同）。
  - 端到端（假安装目录 = 与打包器同布局的真拷贝，双击重编后的 release 壳）：桌包库里一行 `SUCCEEDED`（`progress=100`、`promptId` 有值、1,265,859 字节的 `img_0.png` 落在载荷根 `public/generated/`），并由**桌包自己的 server** 经 `GET /api/generated/…` 原样取回 200——「宿主写的文件 server 发得出来」这条跨进程交接是关键证据；应用「历史」页渲染出缩略图。关窗后入口 / server / 宿主三个 node 全部消失，而**用户自己的 ComfyUI（另一棵进程树）仍在**。
