// OS 进程识别工具：确认某个 main.py 对应的 ComfyUI 进程是否在运行，
// 并定位该进程实际监听的端口。
//
// 场景：ComfyUI 端口被占用时会自动 +1 递增，因此「配置端口有响应」不一定
// 等于「配置路径的实例在运行」——端口上可能跑着别的 ComfyUI。要判断配置
// 的实例是否真的启动了，需要在 OS 层查进程命令行里的 main.py 路径。
//
// Windows 用 PowerShell Get-CimInstance 查命令行，Get-NetTCPConnection 查
// PID 的监听端口；POSIX 用 ps / lsof。
import { execFile } from "child_process";

function execFileP(
  cmd: string,
  args: string[],
  timeoutMs = 3000,
): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout) => {
        if (err) resolve("");
        else resolve(stdout.toString());
      },
    );
  });
}

/** 从进程命令行中查找是否包含指定 main.py 路径的进程。 */
export async function isMainPyProcessRunning(mainPy: string): Promise<boolean> {
  const pid = await findPidForMainPy(mainPy);
  return pid !== null;
}

/**
 * 在 OS 进程列表中查找运行指定 main.py 的进程 PID。
 * 返回 null 表示没有匹配的进程。
 */
export async function findPidForMainPy(mainPy: string): Promise<number | null> {
  if (!mainPy) return null;
  // 规范化路径用于命令行匹配（Windows 大小写不敏感）
  const normalized = mainPy.replace(/[\\/]+/g, "/").toLowerCase();

  try {
    if (process.platform === "win32") {
      // 用 PowerShell 查询命令行含目标路径的进程（转义单引号防注入）
      const safeMain = normalized.replace(/'/g, "''");
      const ps =
        `Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ` +
        `Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Replace('\\\\','/').Contains('${safeMain}') } | ` +
        `Select-Object -First 1 -ExpandProperty ProcessId`;
      const out = await execFileP(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", ps],
        4000,
      );
      const pid = parseInt(out.trim().split(/\r?\n/)[0] ?? "", 10);
      return isNaN(pid) ? null : pid;
    } else {
      // POSIX：ps 输出包含 main.py 的行 → 提取 PID
      const out = await execFileP("ps", ["-eo", "pid,args"]);
      for (const line of out.split("\n")) {
        const ll = line.toLowerCase();
        if (ll.includes(normalized)) {
          const pidStr = line.trim().split(/\s+/)[0];
          const pid = parseInt(pidStr ?? "", 10);
          if (!isNaN(pid)) return pid;
        }
      }
      return null;
    }
  } catch {
    return null;
  }
}

/** 找到指定 PID 正在监听的 TCP 端口号（取第一个 LISTEN 端口）。 */
export async function findPidListeningPort(
  pid: number,
): Promise<number | null> {
  if (!pid || pid <= 0) return null;

  try {
    if (process.platform === "win32") {
      const ps =
        `Get-NetTCPConnection -OwningProcess ${pid} -State Listen -ErrorAction SilentlyContinue | ` +
        `Select-Object -First 1 -ExpandProperty LocalPort`;
      const out = await execFileP(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", ps],
        4000,
      );
      const port = parseInt(out.trim().split(/\r?\n/)[0] ?? "", 10);
      return isNaN(port) ? null : port;
    } else {
      // POSIX：lsof 查指定 PID 的 LISTEN 端口
      const out = await execFileP("lsof", [
        "-Pan",
        "-p",
        String(pid),
        "-iTCP",
        "-sTCP:LISTEN",
      ]);
      // 输出示例: node 12345 user 4u IPv4 12345 0t0 TCP *:8188 (LISTEN)
      for (const line of out.split("\n")) {
        const re = /TCP.*:(\d+)\b/;
        const m = re.exec(line);
        if (m) {
          const port = parseInt(m[1] ?? "", 10);
          if (!isNaN(port)) return port;
        }
      }
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * 查找运行指定 main.py 的进程所监听的 TCP 端口。
 * 返回 null 表示进程不在运行或无法确定端口。
 */
export async function findPortForMainPy(
  mainPy: string,
): Promise<number | null> {
  const pid = await findPidForMainPy(mainPy);
  if (!pid) return null;
  return findPidListeningPort(pid);
}

/** 指定 PID 的进程是否仍存活。保活（keepAlive）路径没有直连的 child 可听
 *  exit 事件，就绪/存活判断退化到 OS 层轮询：Windows 用 `tasklist /FI
 *  "PID eq <pid>"` 看是否仍有匹配行；POSIX 用 `kill -0 <pid>`（0 号信号只
 *  探存活不动手）。探测失败一律按「不在」处理，避免误以为还活着。 */
export async function isPidAlive(
  pid: number,
  timeoutMs = 3000,
): Promise<boolean> {
  if (!pid || pid <= 0) return false;
  try {
    if (process.platform === "win32") {
      const out = await execFileP(
        "tasklist",
        ["/FI", `PID eq ${pid}`, "/NH"],
        timeoutMs,
      );
      // /NH 去表头后仍活着会输出一行含 PID 的记录；纯表头或「无任务」说明已退。
      return new RegExp(`\\b${pid}\\b`).test(out);
    }
    // POSIX：kill -0 只做存活探测。
    return await new Promise((resolve) => {
      execFile("kill", ["-0", String(pid)], { timeout: timeoutMs }, (err) =>
        resolve(err === null),
      );
    });
  } catch {
    return false;
  }
}
