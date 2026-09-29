// ── comfy-cli 解释器的落点与「找不到」的提示（纯叶子，无 IO / 无服务端依赖）─────
//
// 为什么单独一份：`executor-cli.ts` 要真起子进程，为「解释器取哪个值」这一行去
// mock 整条派发链不值；同族先例是 `./raw-ui-only-nodes` 与 `./raw-overrides`
// （纯函数进叶子，单测直接喂夹具）。
//
// 背景（ISSUE #1239）：桌包**不随包** Python 与 comfy-cli（百 MB 级环境 + 版本矩阵），
// 所以桌面形态要真出图必须由用户自备解释器。签字口径是**与 `comfyuiPath` 同形**：
// 用户自备 + 设置页指路径，而不是让用户去设环境变量或建 venv。
//
// §18.4 三选一：本模块走第三类（Next server 与执行宿主双宿主共用的纯解析地基，同族是
// `./launch-path.ts`），登记在 `tests/lib-node-only-declarations.test.ts` 的
// `PURE_NODE_HOSTS`。除 `node:path` 外零内建 import、零 server-only 侧依赖。

import path from "node:path";

/** 平台相关的 venv 内解释器落点（`Scripts/python.exe` vs `bin/python`）。 */
function venvPythonParts(platform: NodeJS.Platform): [string, string] {
  return platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"];
}

/**
 * comfy-cli 解释器的落点：**设置项 `comfyCliPython` > `<cwd>/python-venv/comfy-cli/…`**。
 *
 * 设置项的默认值就是 `COMFY_CLI_PYTHON`（见 `app-settings` 的 `DEFAULTS`），所以「设
 * 环境变量」这条老用法照旧生效，而留空时开发检出仍能按项目根的 venv 走——两条链路
 * 都不必改配置。
 */
export function comfyCliInterpreter(
  configured: string | undefined,
  cwd: string = process.cwd(),
  platform: NodeJS.Platform = process.platform,
): string {
  const trimmed = (configured ?? "").trim();
  if (trimmed) return trimmed;
  const [binDir, pyName] = venvPythonParts(platform);
  /* 分隔符按**目标平台**而不是宿主：`path.join` 只会用宿主的规则，那样这个函数在
   * 另一块机器上就测不准（用例要喂 win32/linux 两种平台断言两种形状）。Node 在两个
   * 平台上都同时暴露 `path.win32` 与 `path.posix`，所以按目标平台挑实现。 */
  return (platform === "win32" ? path.win32 : path.posix).join(
    cwd,
    "python-venv",
    "comfy-cli",
    binDir,
    pyName,
  );
}

/**
 * 「找不到解释器」的提示按**形态**分叉：那三条 venv 命令在开发检出里可执行，而桌包
 * 用户既没有 pnpm 也没有检出——照抄只会让人更困惑（与 #1216 里那句「执行 pnpm
 * db:push」同一种错：把开发者出口当作用户出口）。
 */
export function comfyCliMissingHint(input: {
  inCheckout: boolean;
  platform?: NodeJS.Platform;
}): string {
  const platform = input.platform ?? process.platform;
  const [binDir, pyName] = venvPythonParts(platform);
  if (!input.inCheckout) {
    return (
      "桌面版不随包 Python 与 comfy-cli。请自备一个装好 comfy-cli 的 Python 解释器，" +
      "然后在「设置 → 创作后端 → comfy-cli 解释器」里填它的绝对路径" +
      `（例：D:\\tools\\python-venv\\comfy-cli\\${binDir}\\${pyName}），保存后点「重试」。`
    );
  }
  const slash = platform === "win32" ? "\\" : "/";
  const venv = `python-venv${slash}comfy-cli`;
  const pip = `python-venv${slash}comfy-cli${slash}${binDir}${slash}${pyName}`;
  return (
    "请在项目根目录执行：\n" +
    `  ${platform === "win32" ? "python" : "python3"} -m venv ${venv}\n` +
    `  ${pip} -m pip install --upgrade pip\n` +
    `  ${pip} -m pip install comfy-cli\n` +
    "或设置环境变量 COMFY_CLI_PYTHON / 在「设置 → 创作后端 → comfy-cli 解释器」填已有的解释器。"
  );
}
