/* ── 应用设置的**类型、默认值、纯派生**（无 IO）────────────────────────
 *
 * 本目录是 ISSUE #569 第 5 项裁决后的形态：原 `src/lib/app-settings.ts` 把
 * 「设置类型 + 默认值 + 纯派生函数」与「读写 `data/app-settings.json` 的 fs 调用」
 * 混在一个文件里，还顺带 re-export 了 `COMFYUI_DEFAULT_PORT`。于是
 * **浏览器图只要拿到那个常量就会连 fs 一起打进包**（`does not support external
 * modules` → 设置页整页 500，ISSUE #282/#317）。
 *
 * 拆分口径（与 §18.4 的 `.server.ts` 约定一致）：
 *   - 本文件 = 纯部分（类型 / DEFAULTS / 派生），**客户端与服务端都可以引**；
 *   - `app-settings.server.ts` = IO 部分（读缓存 / 写盘），
 *     `getSettingsSync` / `getSettings` / `saveSettings` 的唯一实现；
 *   - 默认端口只有一处定义：`~/lib/endpoints` —— 需要常量的地方**直接引它**，
 *     本文件不再代为转手（转手正是上面那个事故的诱因）。
 *
 * 这样「视图层要一个默认端口」与「服务端要一份设置」走的是两条路，前者
 * 永远碰不到 fs。
 *
 * 设置以 JSON 文件持久化（不占 DB 迁移）：ComfyUI 安装路径、LoRA 训练后端地址、
 * 默认视频工作流等「不属于 Prisma 模型」的偏好。值回落到环境变量；首次读取即
 * 落盘默认值，因此全新安装开箱可用。文件被 git 忽略（本机配置）。
 */

export type AppSettings = {
  trainerUrl: string;
  comfyLorasDir: string;
  /**
   * ComfyUI 安装目录。
   * comfyuiPath 语义（配置的目录可以不是源码根本身）：
   *   - 便携版：<path>\python_embeded\python.exe + <path>\main.py
   *   - 桌面版：配置「实例根」（如 ComfyUI-Installs\ComfyUI2）——
   *     <path>\standalone-env\python.exe + <path>\ComfyUI\main.py（解释器 + 源码）
   *     也可直接配置实例内的 ComfyUI/ 源码根，解释器会向上查找。
   *   - venv：<path>\.venv\Scripts\python.exe + <path>\main.py（同上两件）
   * 配置后任务执行前若 ComfyUI 未运行会自动拉起（comfyuiAutoStart）。
   */
  comfyuiPath: string;
  /** 传给 ComfyUI main.py 的额外命令行参数（如 --input-directory ...）。 */
  comfyuiExtraArgs: string;
  /**
   * 驱动 ComfyUI 的 **comfy-cli Python 解释器**（执行链用它跑 `-m comfy_cli run`）。
   *
   * 留空 = 退回 `<cwd>/python-venv/comfy-cli/{Scripts|bin}/python(.exe)`（开发检出的
   * 默认落点）。桌包**不随包** Python 与 comfy-cli（百 MB 级环境，且带版本矩阵），
   * 所以桌面形态要真出图必须由用户自备一个装好 comfy-cli 的解释器，然后在这里指
   * 路径——与 `comfyuiPath`「用户自备 + 设置项」同一条形态（ISSUE #1239 的签字口径）。
   *
   * 默认值取 `COMFY_CLI_PYTHON`：与 `comfyuiPath ← COMFYUI_PATH` 同形，即**环境变量是
   * 这一项的默认值**，设置页里填过的值优先（`getSettingsSync` 是 `{...DEFAULTS, ...文件}`）。
   */
  comfyCliPython: string;
  /** 提交任务发现 ComfyUI 未运行时，是否自动按 comfyuiPath 启动。 */
  comfyuiAutoStart: boolean;
  /**
   * ComfyUI 监听端口。留空 = 默认 8188；非默认端口会在启动时显式传
   * `--port`，保证「界面显示端口 = 实际端口」。连接地址固定 127.0.0.1
   * （ComfyUI 由本应用拉起；远程实例可用环境变量 COMFYUI_BASE 覆盖）。
   */
  comfyuiPort: number;
  /**
   * 是否要求登录才能调用 REST 接口（自定义节点解析 / 素材 / 上传 /
   * 日志 / LLM 配置等）。false（默认，本机单用户模式）= 未登录自动落到
   * 演示用户，与 tRPC authedProcedure 的回退一致；true = 严格 401。
   */
  loginRequired: boolean;
  /**
   * 应用进程退出时是否连带关闭自己拉起的 ComfyUI（进程保活开关，默认 false）。
   * 语义：桌面壳退出是 taskkill /T /F 杀整棵进程树，被杀进程没有任何清理
   * 机会，所以这个开关不是「退出时再决定」，而是「拉起时决定是否脱离进程树」。
   * true = ComfyUI 挂在应用进程树内，应用退出连带关闭；false = 脱离进程树
   * 保活，下次打开应用直接复用。仅对本应用拉起的实例生效（外部启动的不归它管）。
   * 改动会在「下一次拉起」生效。
   *
   * 默认取「保活」：ComfyUI 冷启动 + 加载模型是分钟级的成本，默认随应用退出
   * 连杀会让每次打开应用都要重付一遍；且被杀时正在跑的任务没有机会收尾。
   */
  exitKillComfyui: boolean;
  /** 同 exitKillComfyui，作用于应用拉起的 Ollama serve 进程。 */
  exitKillOllama: boolean;
  /**
   * 查看「绑定到本地文件的工作流」详情时，是否自动把磁盘上的最新内容同步回库。
   *
   * 默认 false（手动）：进详情只**检出**磁盘有没有更新、不写库，真正的更新入口
   * 是工作流库里的「同步」按钮（`workflow.resync`）—— 否则「切界面」就等于
   * 「同步」，用户还没决定内容就变了、标记也翻回无更新（PR #806 修的就是这个）。
   *
   * 开启后，「进详情」等价于「点同步」：检出到磁盘有更新就立刻重导入并落库，
   * 用户无需回到列表点按钮。两种入口复用同一条重导入链路（`reimportFromSource`），
   * 产物一致。
   */
  autoSyncLocalWorkflow: boolean;
  /**
   * exitKillComfyui 默认值迁移标记（一次性，非用户可见开关）。
   * 该开关的历史默认值是 true，而 saveSettings 会把整个对象（含默认值）写盘 ——
   * 于是老安装的设置文件里都躺着一条 true，光改 DEFAULTS 对它们不生效。
   * 首次读到没有本标记的文件时把值落成新默认并写标记；之后用户手动勾选不再被覆盖。
   */
  exitKillComfyuiDefaultMigrated?: boolean;
};

export const DEFAULTS: AppSettings = {
  trainerUrl: process.env.LORA_TRAINER_URL ?? "",
  comfyLorasDir: process.env.COMFY_LORAS_DIR ?? "",
  comfyuiPath: process.env.COMFYUI_PATH ?? "",
  comfyuiExtraArgs: "",
  // 环境变量只是这一项的**默认值**（与上面 comfyuiPath 同形）；设置页里填过的值优先。
  comfyCliPython: process.env.COMFY_CLI_PYTHON ?? "",
  comfyuiAutoStart: true,
  comfyuiPort: 0,
  loginRequired: false,
  exitKillComfyui: false,
  exitKillOllama: true,
  /** 绑定到本地文件的工作流：进详情是否自动把磁盘最新内容同步回库（默认手动）。 */
  autoSyncLocalWorkflow: false,
};

/** 退出策略默认值变更的一次性迁移（判据见 exitKillComfyuiDefaultMigrated）。
 *  纯函数、不做 IO —— 导出供单测直接锁住「迁移一次就收手」的行为。 */
export function migrateExitDefaults(settings: AppSettings): AppSettings {
  if (settings.exitKillComfyuiDefaultMigrated === true) return settings;
  return {
    ...settings,
    exitKillComfyui: DEFAULTS.exitKillComfyui,
    exitKillComfyuiDefaultMigrated: true,
  };
}

/** 退出策略：应用进程退出时是否连带关闭自己拉起的后台服务。 */
export type ExitPolicy = {
  /** true = 应用退出连带关闭 ComfyUI；false = ComfyUI 保活（默认）。 */
  exitKillComfyui: boolean;
  /** true = 应用退出连带关闭 Ollama（默认）；false = Ollama 保活。 */
  exitKillOllama: boolean;
};
