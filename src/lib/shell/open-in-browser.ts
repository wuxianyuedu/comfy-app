// 用系统默认浏览器打开 URL。
//
// 等价于桌面壳里 tauri-plugin-opener 的「拉起系统浏览器」效果，但走 Node
// 服务端命令（start / open / xdg-open），不需要动 Rust、不需重编壳。
// 返回 ok=false 时 detail 给出可行动的提示。
//
// 注意：不要用 exec 拼整串命令——exec 本身会再包一层 cmd /d /s /c，
// 手动加的引号会被 cmd 的引号剥离规则啃掉（历史事故：`"start"""` 导致
// 打开失败）。必须用 spawn 命令 + 参数数组，绕开 shell 二次解析。
// Windows：`start` 是 cmd 内建命令，须以 `cmd /c start "" <url>` 调用；
// 空标题参数 "" 用于防止 URL 里的 & 被当成 start 的窗口标题。
//
// §18.4 三选一：本模块走第三类（P3 迁移第 1 期·lib 层地基批）——依赖 Node
// 内建 `child_process` + 纯函数 `~/lib/error-message`，登记进
// `tests/lib-node-only-declarations.test.ts` 的 `PURE_NODE_HOSTS`。
import { errorText } from "~/lib/error-message";
import { isHttpUrl } from "~/lib/url-scheme";
import { spawn } from "child_process";

export async function openUrlInBrowser(
  url: string,
): Promise<{ ok: boolean; detail: string }> {
  /* 协议闸门：只把 http(s) 交给系统浏览器。
   * 这一层的语义是「把控制权交给外部程序」，而调用点里至少有一条
   * （`setting.openExternal`）的目标地址**来自请求方**、且此前只有 `z.string().url()`
   * 那一道 —— 它放行 `file:` / `javascript:` / 任意自定义协议。Windows 上
   * `cmd /c start "" <协议>:…` 会直接拉起协议处理器对应的本机程序
   * （`search-ms:` / `ms-msdt:` 这类是有历史利用链的），`file:` 则是读本机文件。
   * 拦在这里而不是各个调用点：判据只写一次（§12.12），而内部那两条
   * （`comfyOpen` / `dbStudioOpen`）给的本来就是 http 地址，加闸不改行为。
   * 返回 `{ ok: false, detail }` 而不是抛 —— 这正是本模块既有的失败形状，
   * 前端拿得到原因（硬规则 4）。 */
  if (!isHttpUrl(url)) {
    return {
      ok: false,
      detail:
        "只允许在浏览器打开 http/https 地址（`file:`、`javascript:` 与自定义协议一律拒绝），已拦下、未发起外部动作",
    };
  }
  const platform = process.platform;
  const cmd =
    platform === "win32"
      ? (process.env.ComSpec ?? "cmd.exe")
      : platform === "darwin"
        ? "open"
        : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    await new Promise<void>((resolve, reject) => {
      // 不走 shell：Node 按数组参数直接构造命令行，URL 原样送达，
      // 不经 cmd 二次引号剥离。`start` 需经 cmd（内建命令），由 cmd /c 承载。
      const cp = spawn(cmd, args, {
        stdio: "ignore",
        windowsHide: true,
      });
      cp.on("error", reject);
      cp.on("spawn", () => {
        // spawn 成功即认为打开指令已送达（浏览器进程由系统拉起），
        // 不等子进程退出——macOS `open`、Linux `xdg-open` 会很快退出，
        // Windows cmd /c start 更是立即返回。
        cp.unref();
        resolve();
      });
    });
    return { ok: true, detail: `已调用系统默认浏览器打开 ${url}` };
  } catch (e) {
    return {
      ok: false,
      detail: `${errorText(e, "打开系统浏览器失败")}。可手动在浏览器访问 ${url}`,
    };
  }
}
