## Changed

- **`src/app/(main)/settings/hooks/use-settings-page.ts` 再抽两个 sub-hook**：
  PR-27 把类型与常量拆出后主文件从 1331 降到 1078，`useSettingsPage` hook
  本体仍 900+ 行。这一步把两组自包含动作各自沉成 sub-hook：
  · **`./use-settings-page-app-update`**（116 行）—— Tauri updater 与安装
  / 重启的三个动作 + 8 条暂态 + 一把 `useReentrancyLock` 单飞闸门；返回
  一个已拼好的 `AppUpdateView` 对象（含 `inShell`），主 hook 一行
  `const { appUpdate, checkAppUpdate, installAppUpdate, relaunchApp } =
    useSettingsAppUpdate()` 接住；
  · **`./use-settings-page-db-studio`**（135 行）—— Drizzle Studio 的 4 条
  tRPC 通道（`dbStudioStatus` 查询 + `dbStudioStart` / `Stop` / `Open`
  三个 mutation）+ 三态（starting / stopping / opening）+ 三动作
  （startDbStudio / stopDbStudio / openDbStudio）+ `useRuntimeLogSource`
  「按会话跟随启动」的 active 判据。返回 `dbStudioStatus`（把
  `raw.port ?? 4983` 兜底也搬进来了，主 hook 不再逐字段拼装）+ 一个已
  经把 `active` 合并进去的 `dbStudioLog`（原写法 `{ ...dbStudioLog,
    active: dbStudioLogActive }` 一并消失）。主 hook 一行解构，控制器组装
  从 6 行降到 5 个字段直传。
  两组都通过参数（`statusQueriesEnabled` 门控 / `showFlash` 通道）与主 hook
  保持松耦合，返回值**逐字段等价**于原控制器，视图与测试都不感知——§12.18
  复用优先。

  主文件 1078 → 966 行（-112 / -10%）；`scripts/.file-size-baseline.json`
  里基线跟着从 1079 降到 966。tsc 绿；`src/app/(main)/settings/**` **5 测试
  文件 67 用例**全过；`check-circular-deps` 无新增环（两个新 sub-hook 都
  只 import 上层 lib + 现有 hooks，主 hook 单向依赖它们）。

  下一步（另开 PR）：Ollama 组与 Comfy 组也可以照这个模式抽；Comfy 与
  `savePrefs` 里的 `comfyInstanceQ.refetch` 交叉，需要传 ref 进 sub-hook。
