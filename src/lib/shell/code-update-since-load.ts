/* ── 「页面跑着上一版代码」的判据（规范 17 §17.2 第①层，纯函数无 IO）──────
 * 为什么需要它（ISSUE #389）：「陈旧实例」这类崩溃的成因不是某个动作写错了，
 * 而是**运行中的模块图停在改动之前**——把应用长开着、期间拉到了新代码，
 * 已挂载组件里的旧实例与新模块就错位了。要让用户知道该怎么办，先得有一条
 * 能判定「这次会话确实跑过一段代码更新」的事实；本条就是这个判据的单一来源。
 *
 * 判据（满足任一即为「跑过代码更新」）：
 *   · `updatedSinceLoad`：页面加载之后模块被替换过（热更新 / 实时重载），
 *     由 `HotReloadWatcher` 订阅构建标识变化给出；
 *   · `pageOlderThanBuild`：**页面加载的那一刻**拿到的构建标识就与当前模块
 *     不一致——页面是旧的（服务重启过 / 缓存了旧 chunk），连挂载时的实例都
 *     不是最新代码造的。
 *
 * 两者都不看「改动发生在哪个文件」：构建标识由构建器在服务端生成，任何被
 * 客户端 import 的模块改动都会让它变，这正是「运行图可能已过期」的定义。
 */

/** 构建标识的请求路径（服务端按构建器实时给出，不缓存）。 */
export const BUILD_ID_ENDPOINT = "/api/dev/build-id";

/** 读取构建标识的短超时；取不到就当作「无法判定」，绝不阻塞任何交互。 */
export const BUILD_ID_TIMEOUT_MS = 2500;

export interface CodeUpdateSignal {
  /** 页面加载后模块被替换过（热更新 / 实时重载）。 */
  updatedSinceLoad: boolean;
  /** 页面加载时的构建标识就已经落后于当前构建。 */
  pageOlderThanBuild: boolean;
}

/** 是否应认定「本会话跑过一段代码更新」。 */
export function hasCodeUpdated(signal: CodeUpdateSignal): boolean {
  return signal.updatedSinceLoad || signal.pageOlderThanBuild;
}

/**
 * 判定一次构建标识变化是否值得上报。
 *
 * 首次拿到标识（`baseline === null`）只是建立对比基准，不算「刚被更新」——
 * 否则每次冷启动都会立刻上报一次。`pageOlderThanBuild` 那条事实由调用方在
 * 建立基准时单独记录（见条件 ②）。
 */
export function isBuildIdChange(
  baseline: string | null,
  next: string | null,
): boolean {
  if (baseline === null || next === null) return false;
  return baseline !== next;
}

/**
 * 构建标识是否落后：页面加载时拿到的标识与当前标识不一致。
 *
 * 两者都取不到标识时（服务端未就绪、接口不可达）返回 false —— **无法判定
 * 不等于过期**，宁可漏报也不误报「页面是旧的」。
 */
export function isPageOlderThanBuild(
  loadedAt: string | null,
  current: string | null,
): boolean {
  if (loadedAt === null || current === null) return false;
  return loadedAt !== current;
}

/**
 * 判定进程是否真的重启：bootId 变化（且前后都取得到）。
 *
 * 为什么单拎 bootId：`buildId` 里混了源码 mtime 指纹，mtime 变（改了代码）也会
 * 让 buildId 变，但那不是「服务重启」。只有 bootId 变才是 dev server 进程真的
 * 换了一次——这值得单独提示用户（服务重启会短暂中断进行中的任务连接）。
 * 任一侧取不到 bootId（端点未就绪 / 旧版壳）时返回 false：无法判定不等于重启。
 */
export function isBootIdChange(
  prev: string | null,
  next: string | null,
): boolean {
  if (prev === null || next === null) return false;
  return prev !== next;
}

/* ── 构建标识的网络读取（第②层的网络部分，规范 17 §17.2）──────────────
 * 收口在这里的理由与其它 `<domain>-client.ts` 一致：视图/逻辑层只关心
 * 「拿到标识没有、变了没有」，不发裸 fetch。
 */

/** 构建标识的读取结果：字段为 null = 这一次没读到（服务端未就绪 / 接口不可达）。 */
export interface BuildIdProbe {
  buildId: string | null;
  /** 进程启动标识；单独解析出来用于区分「重启」与「仅源码变」。 */
  bootId: string | null;
  /** 启动器自愈重启 dev server 时注入的原因（如 stale-route-table）；无则 null。 */
  restartReason: string | null;
}

/** 读一次构建标识；任何失败都退化为全 null，绝不抛出、绝不阻塞交互。 */
export async function fetchBuildId(): Promise<BuildIdProbe> {
  const empty: BuildIdProbe = {
    buildId: null,
    bootId: null,
    restartReason: null,
  };
  try {
    const res = await fetch(BUILD_ID_ENDPOINT, {
      cache: "no-store",
      signal: AbortSignal.timeout(BUILD_ID_TIMEOUT_MS),
    });
    if (!res.ok) return empty;
    const data = (await res.json()) as {
      buildId?: unknown;
      bootId?: unknown;
      restartReason?: unknown;
    };
    return {
      buildId:
        typeof data.buildId === "string" && data.buildId ? data.buildId : null,
      bootId:
        typeof data.bootId === "string" && data.bootId ? data.bootId : null,
      restartReason:
        typeof data.restartReason === "string" && data.restartReason
          ? data.restartReason
          : null,
    };
  } catch {
    return empty;
  }
}
