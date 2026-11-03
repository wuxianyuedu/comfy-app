## Changed

- **oxlint `typescript/strict-boolean-expressions` 批 16：
  `src/components/studio` 直下文件清零（85 处 / 39 份）**（ISSUE #2776 /
  #2917）：WorkflowIOPreviewPanel 10、workflow-io 9、workflow-utils 8、
  LocalComputeCard 4、NavItems / VideoQueueModal / SourceModal /
  FilmStudioPropertyPanel / ShellTabs 各 3，2 处×8 份（ToastProvider、
  workspace-tabs、WorksGallery、HomePage、ProjectOutputs、ModelTagManager、
  workflow-io.test、ProjectCanvas），1 处×23 份（含 AppShell×3 与 TopBar 的
  matchMedia 桩防御、film-studio-config 的 `raw.imageUrl` unknown 真值、
  model-library-config 的 `fmtSize` 可空 number 等）。
  - 口径与前几批一致：可空布尔 → `=== true`；`string | null` →
    `!== null && !== ""`；`string | undefined` → `!== undefined && !== ""`；
    `unknown` / 恒真对象防御 → `Boolean(x)`；`fmtSize` 的 `!n`（0 是本域
    「尚未探到体积」语义、有用例钉住）→
    `n === undefined || n === null || n === 0 || Number.isNaN(n)`；
    可选链判空后分支内还要读属性的写成显式比较保住 TS 收窄。
  - 验证：按 27 / 19 / 16 / 23 分四组改写、逐组重拉复核 0 残留，整目录
    终扫直下与子目录均 0；vitest 就近跑 studio 目录 148 份 1593 用例
    全绿（首跑 1 处 syncCalls 计数红，串行复跑即绿，定性为并发负载假红）；
    全量 `tsc --noEmit` 绿。
  - 剩余总量见批 16 收尾后的 `log/tools/sbe-remaining-2026-11-02.md`
    （280 处 / 107 份）。
