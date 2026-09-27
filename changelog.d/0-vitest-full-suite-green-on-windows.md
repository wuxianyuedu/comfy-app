## Fixed

- **全量 `pnpm test` 在 Windows 开发机上恢复全绿**（此前 20 个文件、30+ 用例在
  全量跑里失败，且大多与本次改动无关——四类根因各修各的）：
  - **契约口 `seed` 在注册表白名单缺失（真 bug）**：#942 把「种子」做成内置契约口
    （`exposedParamsForMode` 恒产它），但 `MODE_CONTRACT_INPUT_TYPES` 没同步——
    契约一旦走归一化 / 保存链路，seed 口被静默过滤，ShotStudio 的「高级·种子」
    会失灵。补上白名单行与适配器映射表（穷尽 Record 的编译闸同时要求补
    `CONTRACT_INPUT_TO_ADAPTER.seed`），三处按旧口径写的测试断言随之更新。
  - **Build-Guard 夹具与 #784 后判据脱节**：#784 去掉「启动器」概念后，陈旧壳的
    判据只剩「快照里拿不到可执行路径」，测试夹具还在构造带完整 Path 的壳——
    按现行判据修正夹具（Path 留空、命令行带仓库根）。
  - **`src/server/db.ts` 无法关闭连接**：新增 `closeDb()`（libsql 客户端此前
    从不释放），db-schema-ready 测试清理临时目录在 Windows 上不再因句柄未释放
    撞 EPERM。
  - **启动器测试把 Windows 路径直接塞进 ESM import**：`import "F:\…"` 是非法
    说明符（POSIX 绝对路径恰好合法，于是 CI 绿、Windows 红），统一转
    `pathToFileURL().href`。
  - **toolchain-gate 的 8 个用例依赖 POSIX 执行语义**（内核解析 shebang /
    chmod 的 exec 位）：加 `needsPosixExec`（`it.skipIf(win32)`）平台守卫——
    它们给 POSIX CI 钉契约；Windows 侧形态判据已由不依赖真实 spawn 的用例钉住。
    其中「候选不可用原因」一例拆成平台无关 + POSIX 专属两半，Windows 覆盖不丢。
  - **全量并行的超时抖动**：循环依赖 / 死导出 / 注释语言 / 主题 token 等真扫全仓
    的守卫用例，单跑 2~7s、满载翻几倍，按默认 5s / 10s 超时随机红。超时与并发
    预算按实测重定（`testTimeout: 20s` 天花板 + `maxWorkers: 8`，master #1152 的
    口径），LogPanel 这类重交互文件整文件放宽到 45s、不再给单个用例补显式超时。
  - **FilmStudio 快照未随语义 token 迁移重生成**（迁移后的类名是对的，快照过期），
    重新生成。
  - **24 行英文注释中文化**（TopBar / command / WorkflowRunRawCliModal /
    select-menu / form-field / agent-film / check-ui-primitives 等 8 个文件），
    注释语言棘轮基线回到 0。
