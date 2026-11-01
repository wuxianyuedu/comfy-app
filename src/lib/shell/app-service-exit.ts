/* ── 「应用服务为什么断了」的单一事实（规范 17 §17.2 第①层，纯函数无 IO）──
 *
 * 用户报告（ISSUE #1692）：「有时候应用服务莫名就断开了，前端需要能知道原因」。
 * 现状是状态栏那一格只会翻成「应用服务已断开」——用户知道**断了**，但完全
 * 不知道**为什么**：是编译失败、被别的实例顶掉了端口、还是服务自己崩了。
 * 规范 §10.3.1 写得很清楚：**降级不得静默**，「为什么降级」这条原因在运行时
 * 可知就必须采集下来，并配一句可执行的动作。
 *
 * ## 为什么原因必须由「活下来的那一方」提前写下来
 *
 * 探测这一格用的是 `GET /api/dev/server-id`——它由**应用服务自己**应答。服务
 * 一旦不在，这条通道必然不通，此刻再去「问它为什么没了」是问不到的。
 * 于是原因只能在**它死的那一刻**被旁证人记下来，且记在一个「服务不在也能读」
 * 的地方：
 *
 *   · **启动编排（dev / prebuilt 链路）**：`scripts/dev-launcher.mjs` 的
 *     `concludeDownstreamExit` 本来就判出了成因（`downstreamExitKind` +
 *     dev 的 `exitCode` / `signalCode`），只是过去只在启动失败弹窗里讲一次。
 *     现在同一份结论落进 `run/app-service-exit.json`。
 *   · **桌面包（standalone 内嵌 server）**：壳持有 sidecar 句柄，
 *     `CommandEvent::Terminated` 就带着退出码——**壳活着、服务没了**，用户看到
 *     的正是「窗口还在、页面全连不上」。壳写同一份记录。
 *
 * ## 读的一侧
 *
 * 存活通道只有一条：**Tauri 壳的 IPC**（`invoke` 走壳进程，不经过死掉的服务）。
 * 壳侧命令 `get_app_service_exit` 把这份记录读回来；页面在探测到断开时取一次，
 * 把原因与动作一起展示。浏览器（非壳）环境下没有这条通道，界面维持原样——
 * 不编一个「未知原因」出来。
 *
 * 本模块只有判据与文案：记录形状、解析（容忍坏文件）、成因 → 用户可读的
 * 「为什么 + 能做什么」。写入侧（`.mjs` 与 Rust）与本模块共享**同一组字段名
 * 与同一组成因取值**，漂开即「记录写进去了、界面读不懂」。
 */

/** 应用服务结束的成因（写入侧与本模块共用的取值，不许各写一套）。 */
export type AppServiceExitKind =
  /** 服务自己退出（编译失败 / 端口被占 / pnpm 异常）。 */
  | "dev-server"
  /** 服务随桌面壳一起退出：壳以非零码结束（另一次启动顶掉 / 被强行收走）。 */
  | "shell-self-exited"
  /** 服务随桌面壳一起退出：壳侧没有任何收尾标记（被强行收走 / 崩溃）。 */
  | "shell-terminated"
  /** 用户关掉启动页 = 放弃本次启动（设计内行为，不是故障）。 */
  | "abandoned"
  /** 桌面包里内嵌的 standalone server 自己终止了（壳还活着）。 */
  | "sidecar"
  /** 未能归类：退出码与信号都拿不到。 */
  | "unknown";

/** 落盘的结束记录（`run/app-service-exit.json`）。 */
export type AppServiceExitRecord = {
  /** 记录时刻（ISO）。 */
  at: string;
  /** 退出码；拿不到为 null（不是 0——0 是「正常退出」这个具体结论）。 */
  code: number | null;
  /** 成因，取值见 {@link AppServiceExitKind}。 */
  kind: AppServiceExitKind;
  /** 应用服务监听端口；拿不到为 null。 */
  port: number | null;
  /** 一句话原因摘要（写入侧给的**具体**描述，如退出码或壳的处置建议）。 */
  reason: string;
  /** 本次运行标识（`run.json` 的 runId），便于与归档日志对上。 */
  runId: string | null;
  /** 终止信号（SIGKILL 等）；没有为 null。 */
  signal: string | null;
};

/** 记录文件的固定名（写在 `run/` 下，与 `launch-status.json` 并列）。 */
export const APP_SERVICE_EXIT_FILE = "app-service-exit.json";

/**
 * 解析落盘的记录。
 *
 * **容忍坏文件**：这条记录的消费者是「已经出故障时」的界面，此时任何抛错都只会
 * 让现场更难查。读不懂（缺字段 / 类型不对 / JSON 坏了）一律回 null，界面按
 * 「没有原因可讲」处理，而不是显示半个对象。
 *
 * 不认识的 `kind` 收成 `unknown`（而不是丢弃整条记录）：未知成因仍然值得说
 * 「服务退出了，退出码 N」——升级前后版本混跑时这条尤其常见。
 */
export function parseAppServiceExitRecord(raw: unknown): AppServiceExitRecord | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  /* SAFETY: 类型断言已复核 */
  const o = raw as Record<string, unknown>;
  if (typeof o.at !== "string" || o.at === "") {
    return null;
  }
  if (typeof o.reason !== "string") {
    return null;
  }
  return {
    at: o.at,
    kind: asExitKind(o.kind),
    code: typeof o.code === "number" ? o.code : null,
    signal: typeof o.signal === "string" && o.signal ? o.signal : null,
    reason: o.reason,
    port: typeof o.port === "number" ? o.port : null,
    runId: typeof o.runId === "string" && o.runId ? o.runId : null,
  };
}

function asExitKind(value: unknown): AppServiceExitKind {
  switch (value) {
    case "dev-server":
    case "shell-self-exited":
    case "shell-terminated":
    case "abandoned":
    case "sidecar": {
      return value;
    }
    default: {
      return "unknown";
    }
  }
}

/** 界面直接可渲染的「为什么 + 能做什么」。 */
export type AppServiceExitNotice = {
  /** 可执行的动作（规范 §10.3.1 第 2 问：不要只陈述现象）。 */
  action: string;
  /** 退出事实的技术摘要（退出码 / 信号，见 {@link summarizeAppServiceExit}）。
   *  与 `why` 分开：`why` 说「这类故障意味着什么」，这条说「这一次具体是什么结束的」
   *  —— 排查时两者的用途不同，混成一句会让任一侧缺信息。 */
  detail: string;
  /** 一句话原因（状态栏 title 首行 / 通知标题）。 */
  why: string;
};

/** 终止信号的通俗解释（`signal` 是给排查者看的原始值，这里是给人看的）。 */
const SIGNAL_HINT: Record<string, string> = {
  SIGKILL: "被强制结束（内存不足被系统结束、或任务管理器结束进程都会这样）",
  SIGTERM: "收到结束请求后退出",
  SIGINT: "被中断（如终端里的 Ctrl-C）",
  SIGSEGV: "自身异常崩溃",
  SIGABRT: "自身异常中止",
};

/** 退出码的通俗解释（只列本项目真会撞上的几个）。 */
const CODE_HINT: Record<number, string> = {
  1: "以错误码退出",
  137: "被强制结束（常见于内存不足）",
  143: "收到结束请求后退出",
};

/**
 * 把记录折叠成「为什么断了 + 能做什么」。
 *
 * 文案按成因分档而不是一句通用话：这几种成因的处置完全不同——把「用户放弃启动」
 * 说成「服务崩溃」会让人白查半小时（历史事故同源，见 `describeDownstreamExit`
 * 的注释），反过来则会把真故障说成设计内行为。
 */
export function describeAppServiceExit(record: AppServiceExitRecord): AppServiceExitNotice {
  /* 技术摘要对所有分支都一样（「这一次具体是什么结束的」与成因分档正交），
   * 因此在这里算一次、由每个分支带上，而不是让七个分支各写一遍。 */
  const detail = summarizeAppServiceExit(record);
  switch (record.kind) {
    case "abandoned": {
      return {
        why: "上一次启动被放弃（启动页被关闭），本地服务随之退出",
        action: "这是设计内行为：重新双击启动入口即可，等启动页自动切到主界面",
        detail,
      };
    }
    case "shell-self-exited": {
      return {
        why: "本地服务随桌面壳一起退出了（壳自身以非零码结束）",
        action:
          "若只是把已在运行的窗口唤到前台，本次双击不会启动新进程；" +
          "否则重新双击一次启动入口，并对照 log/launcher/ 下的日志",
        detail,
      };
    }
    case "shell-terminated": {
      return {
        why: "本地服务随桌面壳一起退出了，且壳没有留下任何收尾标记（被强行收走或崩溃）",
        action:
          "重新双击一次启动入口并**只双击一次**、等启动页自己切换；" +
          "若反复发生，把 log/launcher/ 与 log/shell/ 一起带上排查",
        detail,
      };
    }
    case "sidecar": {
      return {
        why: `内嵌的本地服务已终止${record.code === null ? "" : `（退出码 ${record.code}）`}`,
        action: "关掉应用窗口重新启动一次；若反复出现，把 log/nextjs/ 带上排查",
        detail,
      };
    }
    case "dev-server": {
      return {
        why: "本地服务自身退出了（编译失败 / 端口被占 / pnpm 异常都会这样）",
        action: "看 log/nextjs/ 下最新一份输出；重新启动一次通常即可恢复",
        detail,
      };
    }
    default: {
      return {
        why: `本地服务已退出${record.code === null ? "" : `（退出码 ${record.code}）`}`,
        action: "重新启动一次应用；若反复出现，把 log/ 下的诊断包带上排查",
        detail,
      };
    }
  }
}

/**
 * 一句话摘要：成因 + 可读的退出事实。
 *
 * `code` / `signal` 的取舍有讲究：**信号优先于退出码**——被 SIGKILL 强杀与
 * 自己 `exit 1` 的排查方向完全相反，而 Windows 上两者都会表现成一个非零码。
 * 两者都拿不到时**说拿不到**，不编一个「退出码 0」（0 是「正常退出」这个具体
 * 结论，编出来会把故障说成正常）。
 */
export function summarizeAppServiceExit(record: AppServiceExitRecord): string {
  if (record.signal) {
    const hint = SIGNAL_HINT[record.signal];
    return hint ? `服务被 ${record.signal} 结束：${hint}` : `服务被信号 ${record.signal} 结束`;
  }
  if (record.code !== null && record.code !== 0) {
    const hint = CODE_HINT[record.code];
    return hint ? `服务${hint}（退出码 ${record.code}）` : `服务以退出码 ${record.code} 结束`;
  }
  if (record.code === 0) {
    return "服务正常退出（退出码 0）";
  }
  return "服务已退出，但未拿到退出码或信号";
}

/* ── 读取侧：从「已经恢复的」服务把上一次的结论读回来 ─────────────────────
 * 探活走的是应用服务自己的 HTTP（`/api/dev/server-id`），服务不在时那条通道必然
 * 不通——所以这份记录只能在**新进程已经应答之后**读回，用来回答「刚才那次断开是
 * 因为什么」。端点是 `GET /api/dev/last-exit`（见该 route 的说明）。
 */

/** 读取端点。 */
export const APP_SERVICE_EXIT_ENDPOINT = "/api/dev/last-exit";

/** 读取的超时：与探活同档，取不到就按「没有原因可讲」处理。 */
export const APP_SERVICE_EXIT_TIMEOUT_MS = 2500;

/** 端点的响应形状。 */
export type AppServiceExitProbe = {
  /** 当前应用服务进程的 runId；拿不到为 null。 */
  currentRunId: string | null;
  /** 上一次结束的记录；没有 / 读不懂时为 null。 */
  record: AppServiceExitRecord | null;
};

/**
 * 判断这份记录说的是不是**上一次**运行。
 *
 * 记录是在应用服务死的那一刻写下的，所以它描写的永远是「上一份进程」。判据：
 *   · 记录的 runId 有值、且与当前 runId 不同 → 是上一次（这正是要显示的）；
 *   · 两者相同 → 记录描写的是**当前**这份进程（同一 runId 不可能既死着又应答，
 *     这只可能是启动链路没透传 runId 时的巧合），不显示；
 *   · 任一方为 null（老启动链路 / 纯 web 手工启动）→ **按「可显示」处理**：
 *     这条记录的用途就是排障，此时宁可多显示一次原因，也不要因为拿不到 runId
 *     而把唯一一条线索藏起来。
 */
export function isPreviousRunExit(
  record: AppServiceExitRecord,
  currentRunId: string | null,
): boolean {
  if (record.runId === null || currentRunId === null) {
    return true;
  }
  return record.runId !== currentRunId;
}

/**
 * 把壳读回来的**原文**解析成记录（ISSUE #1915）。
 *
 * 壳那条通道（`get_app_service_exit`，见 `./desktop-shell-client`）刻意只回文件
 * 字面内容、不在 Rust 侧解析：形状只在上一处定义，两侧各解析一遍的漂开表现是
 * 「记录写进去了、界面读不懂」。于是这里补齐 JSON 那一跳，并把坏字面（空串 /
 * 半截 JSON）归到「没有原因可讲」。
 */
export function parseAppServiceExitRaw(raw: string | null): AppServiceExitRecord | null {
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }
  try {
    /* SAFETY: 类型断言已复核 */
    return parseAppServiceExitRecord(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/**
 * 记录「是不是**这一次**断开留下的」——断开那一刻读回时用的判据。
 *
 * 与 {@link isPreviousRunExit} 恰好相反：那条判的是「记录说的是上一份进程」
 * （服务恢复后读回时的语义），而**断开那一刻**要判的正是「记录说的是刚刚没了的
 * 这一份」。所以：
 *
 *   · 两边 runId 都有值 → 相等才算（不等说明盘上留的是更早那一次的结论）；
 *   · 任一方为 null（老启动链路 / 手工 `pnpm dev`）→ 退回**新鲜度**判据：
 *     记录是多久以前写的。刚断的这一刻，旁证人写下它不过几秒；盘上那份若是一小时
 *     前的，它描写的是更早的一次结束，拿它当「这一次的原因」就是编。
 *
 * 为什么必须有新鲜度这一档：这份文件是**单槽**的（每次结束覆盖写），所以「盘上有
 * 一份记录」既可能是刚写的，也可能是几天前留下的。只判「存在」会把旧结论说成这一次
 * 的原因——归因猜错比不归因更坏，它会把排查引向另一条路（同 `describeAppServiceStart`
 * 的注释）。
 */
export function isCurrentDisconnectExit(
  record: AppServiceExitRecord,
  currentRunId: string | null,
  now: number,
): boolean {
  if (record.runId !== null && currentRunId !== null) {
    return record.runId === currentRunId;
  }
  const writtenAt = Date.parse(record.at);
  if (!Number.isFinite(writtenAt)) {
    return false;
  }
  const age = now - writtenAt;
  /* 负值 = 时钟漂移 / 记录来自另一台机器写的文件，同样不可用作「刚刚」。 */
  return age >= 0 && age <= RECENT_EXIT_WINDOW_MS;
}

/**
 * 「刚刚这么写下的记录算不算这一次断开的」——{@link isCurrentDisconnectExit}
 * 在没有 runId 可比时用的新鲜度窗口。
 *
 * 取 10 分钟：断开判定要连续失败两拍（≈4 秒）才成立，写侧也在那一刻前后落盘，
 * 因此正常现场里这个差是**秒级**；窗口放大到分钟级只为容下「用户盯着不动的窗口
 * 过了几分钟才被后台节流影响」这类延迟，同时仍能挡住「盘上留着昨天那份」。
 */
export const RECENT_EXIT_WINDOW_MS = 10 * 60 * 1000;

/**
 * 断开那一刻读回「这一次为什么断」——优先走壳的 IPC。
 *
 * ## 为什么断开时读得到，而 HTTP 端点读不到
 *
 * `GET /api/dev/last-exit` 由**应用服务自己**应答，而断开这件事里没了的正是它，
 * 端点必然不通。壳进程却活得好好的（用户看到的就是「窗口还在、页面连不上」），
 * 它读同一个文件不经过任何应用服务——这就是 ISSUE #1915 要补的那条通道。
 *
 * ## 返回值
 *
 * 拿不到 / 记录属于更早的运行 / 浏览器（非壳）环境 → null：界面按「这一刻没有原因
 * 可讲」处理，**不编一个**「未知原因」出来。判据见 {@link isCurrentDisconnectExit}。
 */
export async function fetchCurrentDisconnectExit(
  currentRunId: string | null,
  now: number,
): Promise<AppServiceExitRecord | null> {
  /* 动态 import：壳客户端要 `@tauri-apps/api`，而本模块也被服务端 / 浏览器链路
   * 引用——静态 import 会把它拖进那些不该有壳依赖的打包图（与
   * `desktop-shell-client` 里其它调用点同一取向）。非壳环境它自己回 null。 */
  const { readAppServiceExitRecord } = await import("./desktop-shell-client");
  const record = parseAppServiceExitRaw(await readAppServiceExitRecord());
  if (record === null) {
    return null;
  }
  return isCurrentDisconnectExit(record, currentRunId, now) ? record : null;
}

/**
 * 拉取上一次结束的记录。
 *
 * 全程不抛错：这条读取跑在「应用刚出过故障」的窗口里，任何异常都只会让现场更
 * 难查。取不到一律回 `{ record: null, currentRunId: null }`（= 没有原因可讲）。
 */
export async function fetchAppServiceExit(): Promise<AppServiceExitProbe> {
  const empty: AppServiceExitProbe = { record: null, currentRunId: null };
  try {
    const res = await fetch(APP_SERVICE_EXIT_ENDPOINT, {
      cache: "no-store",
      signal: AbortSignal.timeout(APP_SERVICE_EXIT_TIMEOUT_MS),
    });
    if (!res.ok) {
      return empty;
    }
    /* SAFETY: 类型断言已复核 */
    const data = (await res.json()) as {
      currentRunId?: unknown;
      record?: unknown;
    };
    return {
      record: parseAppServiceExitRecord(data.record),
      currentRunId:
        typeof data.currentRunId === "string" && data.currentRunId ? data.currentRunId : null,
    };
  } catch {
    return empty;
  }
}
