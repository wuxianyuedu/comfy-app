/**
 * 起 Playwright **之前**的端口占用探测：谁在跑是「真实世界状态」，不是「本轮自己起的」。
 *
 * ## 它修的那一格（ISSUE #1766）
 *
 * `e2e/global-setup.ts` 的探测此前挂在 `globalSetup` 上，而 Playwright 的顺序是
 * 「**起 webServer 并等它可访问** → 跑 `globalSetup`」——于是同一份探测在本地
 * 全量跑上必然探到 **Playwright 自己刚起的那一个**：
 *
 *   · 应用端口那半：`reused === true` → `if (reused && !CI) throw` 是**必然自击**
 *     的机关，一条用例都没跑就红在启动；
 *   · 替身端口那半：判成 `fake` → 每次都打「替身已在运行（复用）；它的 history
 *     带着上一轮的产物」，而那根本不是复用。
 *
 * 判据要问的是「**在我起 server 之前**那个端口上有没有别人」，那它就不能挂在
 * `globalSetup` 上。本模块是那个问题的答案：`scripts/e2e-run.mjs` 在 `spawn`
 * Playwright **之前**调它，那时端口状态就是真实世界状态；结论随一次运行带下去。
 *
 * ## 为什么结论要带回 `globalSetup`，而不是就此消失
 *
 * 两个位置各能回答一半：
 *   · **pre-flight（本模块）** 回答「起之前有没有别人」——替身端口上坐着真件 /
 *     陌生服务、应用端口上坐着一个**别人的** dev server，都只能在这里判；
 *   · **`globalSetup`** 回答「谁在跑」——它跑在 webServer 之后，看到的是
 *     「本轮的 server」+「起之前就在的」之和，所以它只能**说话**（复用时提示
 *     替身的 history 不是本轮的），不能再凭「有人应答」判冲突。
 *
 * 把「起之前就在」这个事实带过去（`E2E_PREFLIGHT_ENV_KEY`），`globalSetup` 才能
 * 把两者分开：本轮自己起的不说「复用」，起之前就在的才说。
 *
 * ## 它不阻断「真件在跑」
 *
 * 8188 上有真 ComfyUI 是**正常状态**（`fake-comfyui-endpoint.mjs` 的文件头就是
 * 「不必停真件」的取向），本模块只判两个**本应用自己的端口**。
 */
import net from "node:net";

/** 承载 pre-flight 结论的环境变量键（`e2e-run.mjs` 写、`globalSetup` 读）。 */
export const E2E_PREFLIGHT_ENV_KEY = "E2E_PREFLIGHT";

/**
 * 一次 pre-flight 的结论：**两个端口在起 Playwright 之前**有没有人应答。
 *
 * 两个布尔各回答一件事，不合并成一个「有冲突」——冲突与否要看「谁在应答」，
 * 而这里只回答得了「有没有人在」。
 *
 * @typedef {{appOccupied: boolean, fakeOccupied: boolean}} PreflightResult
 */

/**
 * 探一次端口有没有人应答。
 *
 * 与 `global-setup.ts` 的 `probeFakeComfySlot` **同一条边界**（连接被拒不是错误），
 * 但这里不需要响应体：pre-flight 只回答「有没有人在」，至于是谁由
 * `classifyFakeSlot` 在 `globalSetup` 那一步判（它拿得到 payload）。
 *
 * 用 TCP 连接而不是 HTTP：`fetch` 会等响应头，而「占了端口的进程不答 HTTP」
 * （比如某些代理 / 半死的进程）照样是占用 —— 只判「连得上吗」更准也更便宜。
 *
 * @param {number} port
 * @param {{host?: string, timeoutMs?: number}} [options]
 * @returns {Promise<boolean>}
 */
export function probePortOccupied(port, options = {}) {
  const host = options.host ?? "127.0.0.1";
  const timeoutMs = options.timeoutMs ?? 1000;
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    let settled = false;
    /** @param {boolean} occupied */
    const done = (occupied) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(occupied);
    };
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => done(true));
    socket.on("timeout", () => done(false));
    socket.on("error", () => done(false));
  });
}

/**
 * 起 Playwright 之前探两个端口：应用端口与替身端口。
 *
 * @param {{appPort: number, fakePort: number, host?: string, timeoutMs?: number}} input
 * @returns {Promise<PreflightResult>}
 */
export async function runPreflight(input) {
  const [appOccupied, fakeOccupied] = await Promise.all([
    probePortOccupied(input.appPort, input),
    probePortOccupied(input.fakePort, input),
  ]);
  return { appOccupied, fakeOccupied };
}

/**
 * 把结论编码成**一行 JSON** 交给子进程。
 *
 * 走环境变量而不是临时文件：`e2e-run.mjs` 起 Playwright 是同步 `spawnSync`，
 * 结论是**这一次运行**的事实，落盘会留下一个「谁写谁清」的次级问题（而按次命名
 * 的临时文件正是本仓库反复踩过的那类）。一行 JSON 也让它肉眼可读。
 *
 * @param {PreflightResult} result
 * @returns {string}
 */
export function encodePreflight(result) {
  return JSON.stringify({
    appOccupied: !!result.appOccupied,
    fakeOccupied: !!result.fakeOccupied,
  });
}

/**
 * 解码 `encodePreflight` 的产出。**读不出就当没有**（返回 null）而不是抛。
 *
 * 不抛的理由：这份结论是「让话术更准」的增强，不是判据的地基。手工 `pnpm exec
 * playwright test` 直接跑时它根本不存在（那时 `globalSetup` 该按「不知道」说话，
 * 而不是崩掉 —— 那条路本来就该能跑）。
 *
 * @param {string | undefined} raw
 * @returns {PreflightResult | null}
 */
export function decodePreflight(raw) {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (typeof parsed.appOccupied !== "boolean") {
      return null;
    }
    if (typeof parsed.fakeOccupied !== "boolean") {
      return null;
    }
    return {
      appOccupied: parsed.appOccupied,
      fakeOccupied: parsed.fakeOccupied,
    };
  } catch {
    return null;
  }
}

/* ── 上一轮留下的替身：**认出来、收掉**，而不是让 Playwright 抛一句看不懂的错 ──
 *
 * ## 它修的那一格（平台的 `E2E 关键流程` 第二次真跑到最后一步时的现场）
 *
 * `cnb-ooc-1k52laqqh` 那一跑，E2E 的日志**第一次露出来**（CP936 外壳修好了），
 * 而它红在一句 Playwright 自己的话上：
 *
 *     [e2e-run] 起 Playwright 前：应用端口 空 / 替身端口 有人
 *     Error: http://127.0.0.1:18188/system_stats …（Playwright 报的「已有人应答」）
 *
 * （后半句是 Playwright 给的两条出路：确认那个口上没人在跑，或把
 * `reuseExistingServer` 设成 true —— 本档两条都不能采纳，见下。）
 *
 * 两件事并排摆着，读法没有第二种：
 *   · pre-flight 探到**替身端口在起 Playwright 之前就有人**（不是本轮自己起的）；
 *   · 而 CI 档 `reuseExistingServer` 是 **false**，于是 Playwright 在探测到「这个 URL
 *     已有人应答」时**直接抛**，连 `globalSetup`（那条会说清「谁在那儿」的路）都到不了。
 *
 * 占位者是从哪来的？同一台自托管节点（`orange-connector`）上**上一跑**的替身 ——
 * 替身进程在 Playwright 的 webServer 里是**孙子进程**（`shell: true` 让它挂在
 * 一层 shell 下面），流水线被取消 / 被杀时那一跳收不到 teardown 信号，节点是复用的，
 * 下一个 build 就撞在它上面。实测那一跑的 15 分钟前是 `cnb-02o-1k52kenip`（同一节点、
 * 同一条命令、23s 即红），中间还夹着两条 `cancel` 的构建。
 *
 * ## 处置：**认出「是我们自己的上次留下的」才收**，收完把结论重算一遍
 *
 * 「替身端口被占」有两种完全不同的情形，而它们的正确动作相反：
 *   · **我们自己的残留**（上一跑漏下的 `fake-comfyui-server.mjs`）⇒ 收掉它、继续跑；
 *   · **别人的东西**（另一份检出正在跑 e2e、或有人把 ComfyUI 配到了这个口）⇒ 绝不碰，
 *     话术照旧把出口给出来（`describeSlotConflict`）。
 *
 * 所以判据是**两条互不兜底的证据**，缺一不可：
 *   ① **命令行点名了本仓的替身脚本**（`e2e/support/fake-comfyui-server.mjs`）——
 *      这是「它是什么」；
 *   ② **它答出来的 `/system_stats` 是替身的形状**（`ram_total === 1`、`devices: []`，
 *      见 `isFakeComfyuiPayload`）—— 这是「它此刻真是那个东西」。
 *
 * ⚠️ 只判 ①（命令行）不够：`sh -c "node e2e/support/fake-comfyui-server.mjs"` 这种
 * 形态在**别的检出**里长得一样，而 §1.4 的多检出并行保护要求「拿不准就不动别人的进程」。
 * 只判 ②（形状）也不够：一个**已经半死**的替身可能答不出形状，而它照样占着端口。
 * 两条一起才是「这就是我们上一跑漏下的那个」。
 *
 * **只在 CI 档生效**：本地跑 e2e 时 `reuseExistingServer` 为真，Playwright 会**复用**
 * 那个替身（`globalSetup` 会如实说「已在运行（复用）；它的 history 带着上一轮的产物」）
 * —— 那是本地刻意留的方便，不该被这一步悄悄改成「杀掉重启」。平台上不存在「复用」
 * 这条路（`reuseExistingServer: false`），残留只会让整格红，所以那里才需要收。
 */

/** 本仓替身脚本的路径片段（命令行判据 ①）—— 与 `playwright.config.ts` 的 webServer
 *  `command` 同一处落点，改那一行时这一行跟着改（`tests/e2e-fake-comfyui-endpoint.test.ts`
 *  判两处一致）。 */
export const FAKE_SERVER_SCRIPT = "e2e/support/fake-comfyui-server.mjs";

/** 命令行是不是**本仓的替身服务**（判据 ①；只答「它是什么」，不答「能不能收」）。
 *
 * 归一化反斜杠并小写：Windows 上那条命令行是 `node e2e/support/…` 或
 * `node e2e\support\…` 两种都真实存在。
 *
 * @param {string} cmdline
 * @returns {boolean}
 */
export function isFakeServerCmdline(cmdline) {
  const text = String(cmdline ?? "")
    .replace(/\\/g, "/")
    .toLowerCase();
  return text.includes(FAKE_SERVER_SCRIPT.toLowerCase());
}

/** 这一档的收尾结论。
 *
 * @typedef {{reclaimed: number[], foreign: number[], free: boolean}} ReclaimResult
 */

/**
 * 端口上那些占位者里，哪几个是**我们自己的替身**（两条证据都要）。
 *
 * 纯函数：两条证据都**已经取好**再喂进来（`cmdlineOf` 查表、`answersFake` 查表），
 * 所以这条判据能被直接断言，不必真起一个进程、也不必把它做成异步（同
 * `classifyFakeSlot` 的处置：怎么取是调用方的事，判什么在这里）。
 *
 * @param {number[]} pids
 * @param {{
 *   cmdlineOf: (pid: number) => string,
 *   answersFake: (pid: number) => boolean,
 * }} evidence
 * @returns {number[]}
 */
export function pickOwnFakePids(pids, evidence) {
  return pids.filter(
    (pid) => isFakeServerCmdline(evidence.cmdlineOf(pid)) && evidence.answersFake(pid),
  );
}
