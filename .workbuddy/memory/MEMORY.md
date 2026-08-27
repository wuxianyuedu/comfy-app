# Comfy-APP 项目记忆

## Ardot MCP 操作格式（已恢复）
- Ardot 桌面端必须先手动打开/新建一个 `.ardot` 文件，MCP 才能编辑（无 `create_design`/`open_file` 工具）。桥 `open-url` 端点稳定 403（预处理器鉴权），无法从外部 HTTP 拉起。
- `batch_edit` 的 `operations` 参数是**逐行 DSL 字符串**，每行格式 `binding = I(parentId, {FigmaJSON})`（I=Insert, U=Update, D=Delete, M=Move, C=Copy, G=GenerateImage）。解析正则：`/^(?:(\w+\s*=\s*)?([ICRUDMG])\((.+)\)$/s`。Node 数据就是标准 Figma JSON 结构，`fills` 使用 `[{type:"SOLID",color:{r,g,b},opacity,visible:true,blendMode:"NORMAL"}]`。
- **子节点 x/y 是相对于父节点的坐标**，不是页面绝对坐标。曾因此导致进度卡/资源库/分镜网格被截断；已修正。
- 源文件：`C:\Users\yuedu\ardot_build_v2.mjs`（工坊全链路管线 v2 设计 builder）。

## Ardot 设计落地状态
- 文件：`Comfy-APP · 模型库（配置 + COMBO）· R-ardot39`（fileId 715102942714570，readwrite），page `工坊全链路管线` (pageId 9:1)。
- v2 生产级界面已推入：顶栏 + 6 阶段左侧导航（①剧本 active / ④⑤⑥ locked）+ 中央故事大纲/16 镜分镜网格/进度 23% + 右侧缺失素材/资源库；暗色极光 token 1:1 对齐。
- 截图核对：`C:\Users\yuedu\ardot_shots\screenshot-10_2498-20260824_122400588.png`，无 warning/issue。已完成顶部横向阶段导航贴左、avatar 贴右、故事大纲/分镜分卡、分镜场景名+状态点+占位图、资源库与缺失素材卡片精修对齐、主卡片 0.08 白色描边。

## 项目目录与版本
- 当前项目目录：`F:\AI\Other\Comfy-APP-T3`（之前曾因路径近似误操作到 `F:\AI\Other\Comfy-APP`，已纠正）。
- 技术栈：`Next.js 16.3.2` + `Turbopack`（`npm run dev` → `next dev --turbo`），React 19，Tailwind v4，Prisma，ComfyUI 本地集成。
- 前端实现文件：`src/components/workshop/WorkshopPipeline.tsx`、`src/app/(main)/workshop/page.tsx`。

## 桌面壳启动流程（2026-08-27 重构 → 预编译壳秒出）
- 入口：`F:\AI\Other\Comfy-APP-T3\start-tauri.exe`（PyInstaller 单文件，默认无 Python 小弹窗）。
- 默认模式：启动器 → `scripts/dev-launcher.ps1 -Prebuilt` → 先启动 `next dev`，再**立即**启动预编译 Tauri 壳 `src-tauri/target/debug/app.exe`（窗口秒出），两者在同一 Job Object 内。
- 预编译壳窗口初始 URL：`splash.html`（`public/splash.html`，生产构建复制到 `src-tauri/static/splash.html`）。
- 启动页：暗色极光风格，调用 Rust commands `get_launch_status` / `navigate_to_app`；ready 后导航到 `http://localhost:3000/workspace`（开发）或 sidecar URL（生产）。
- 环境变量：`COMFYAPP_PROJECT_ROOT`、`COMFYAPP_DEV_URL` 由 launcher 设置，供 Rust 定位状态文件并获知目标地址。
- 调试选项：
  - `start-tauri.exe --splash`：旧版 Win32 小弹窗（调试用）。
  - `start-tauri.exe --tauri-dev`：旧版 `pnpm tauri dev`（慢，但支持 Rust 热重载）。
- 源码提交：`55680bc`（内嵌启动页）、`5673fa7`（预编译壳秒出）。
