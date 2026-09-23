// ── 「在浏览器里持久一件小事」的唯一入口（规范 16 §16.2.4.28）───────────────
//
// 按**形态**扫描时撞出来的账：全库 9 个文件、十余处各写一遍
// 「读 localStorage → JSON.parse → 失败回退默认值」，而它们对三件事各判各的：
//
//   ① **怎么判「没有浏览器」** —— 三种写法同时在用：
//      一种是 `typeof window === "undefined"`、一种是 `typeof localStorage ===
//      "undefined"`、还有一种是干脆不判只靠 try/catch —— 三套同时存在。
//      三者在 jsdom、SSR、隐私模式下**行为不同**：
//      `typeof window === "undefined"` 在 SSR 为真，而 `typeof localStorage`
//      在「window 有、storage 被策略禁用」时为真 —— 后者是隐私模式的真实形态，
//      而只判 window 的那几处会**在隐私模式下抛异常**（外层 try/catch 兜住的是
//      另一件事）。
//   ② **坏数据算不算「没存过」** —— 有的把 `JSON.parse` 失败与「键不存在」
//      都回落默认值（`safeParse`），有的让异常直接冒到调用处
//      （`WorkflowCanvasSettings` / `DimensionControl` / `StyleSwitcher` 各自
//      在本地包一层 try/catch）；而 `workflow-run-store` 的 `hydrate()` 选择了
//      **第三条路**：坏数据静默丢弃、不回落默认值（因为它的「默认值」是空表）。
//   ③ **写失败怎么办** —— 全部静默，但理由各不相同（配额满 / 隐私模式 /
//      存储被禁用），且**没有一处把「这次没记住」告诉用户** —— 这是有意的
//      （记忆是增强不是功能），但只有写下来才不会被下一个人当成漏了反馈。
//
// 所以本模块只做「可机器判定的那一半」：**能不能用 storage**、**读**、**写**、
// **读一个带默认值的 JSON**。键名与数据形状仍归调用处 ——
// 那是域决定（`comfyapp:size-presets:v1` 这类键名带自己的版本策略）。
//
// 与 `~/lib/browser-io` 的分工：那个管「把一段文本送出去」，本模块管
// 「把一件小事留下来」。两者同属浏览器侧能力，但一个是瞬时动作、一个是持久化。

/** 浏览器 storage 是否可用（SSR / 隐私模式 / 被策略禁用时为 false）。
 *
 *  **两个判据都要**：`window` 判 SSR，`localStorage` 判隐私模式 ——
 *  后者在「window 存在但 storage 被禁用」的宿主上会**抛异常**，
 *  只判 window 的写法会在这里炸（历史上有三处是这样）。
 *  访问 `localStorage` 本身可能抛（Safari 隐私模式），所以整段包在 try 里。 */
export function hasBrowserStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      typeof window.localStorage !== "undefined" && window.localStorage !== null
    );
  } catch {
    return false;
  }
}

/**
 * 读一个字符串键；没有浏览器 / 键不存在 / 读失败一律返回 `null`。
 *
 * 不区分「没有浏览器」与「没有这个键」是**刻意的**：两种情况下调用处
 * 该做的事完全一样（用默认值），而分开表达会逼每个调用处写两个分支。
 * 需要区分时用 `hasBrowserStorage()` 单独判。
 */
export function readStorageItem(key: string): string | null {
  if (!hasBrowserStorage()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * 写一个字符串键；没有浏览器 / 写失败（配额满 / 隐私模式）**静默失败**。
 *
 * 返回 `boolean` 是为了让**在意**的调用处能表达（例如「本次会话内有效但
 * 没记住」），不需要它的调用处直接丢弃返回值 —— 与 `copyText` 同款。
 */
export function writeStorageItem(key: string, value: string): boolean {
  if (!hasBrowserStorage()) return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    /* 配额满 / 隐私模式 / 存储被禁用：静默 —— 记忆是增强，不是功能。 */
    return false;
  }
}

/** 删掉一个键；没有浏览器 / 删失败**静默**（口径同上）。 */
export function removeStorageItem(key: string): boolean {
  if (!hasBrowserStorage()) return false;
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * 读一个 JSON 键并回退到默认值。
 *
 * **坏数据与「没存过」都回落默认值**，且**不抛**：这是全库此前写法的并集
 * —— `canvas-store` 的 `safeParse` 是这样，而三个设置控件各自包的 try/catch
 * 也是这样（只是写法更长）。让异常冒出去的那几个调用处，实际都在紧邻的一层
 * 又把它接住了。
 *
 * `parse` 可选：调用处若只存字符串（`"1"` / `"split"`），传 `Number.parseInt`
 * 这类窄化函数即可 —— 不再需要各自写一遍 `raw === "preset" ? ... : ...`。
 */
export function readStorageJson<T>(
  key: string,
  fallback: T,
  parse?: (raw: string) => T,
): T {
  const raw = readStorageItem(key);
  if (raw === null) return fallback;
  if (parse) {
    try {
      return parse(raw);
    } catch {
      return fallback;
    }
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 把一个值按 JSON 存进去；返回是否写成功（口径同 `writeStorageItem`）。 */
export function writeStorageJson(key: string, value: unknown): boolean {
  return writeStorageItem(key, JSON.stringify(value));
}

/**
 * 写一个 cookie（`path=/` + `max-age=<秒>`）；没有浏览器 / 写失败**静默**
 * （口径同 `writeStorageItem`，返回是否写成功）。
 *
 * **为什么这个模块里会出现 cookie**：本模块是「把一件小事留下来」的唯一入口，
 * 而 cookie 是 localStorage 之外的第二条通道 —— 它的独特之处是**服务端读得
 * 到**：`(main)/layout.tsx` 能用 `next/headers` 的 `cookies()` 读出来直接传给
 * `SidebarProvider` 的 `defaultOpen`，于是首屏就渲染成用户上次选的样子，不必
 * 等水合（localStorage 只能等客户端，首屏与客户端不一致就是一次水合不匹配）。
 *
 * 代价要清楚：名称空间是所有 cookie 共享的一个字符串；有效期必须显式给
 * `max-age`（不给就是会话级、关窗即忘）；清理粒度与 localStorage 不同
 * （浏览器里「清除 Cookie」与「清除本地存储」是两个开关）。所以**只在
 * 「必须让服务端读到」这一种情况下用它**，其余一律 `writeStorageItem`。
 *
 * 读侧刻意不在这里提供：服务端读走 `next/headers`，客户端读只能作为水合后的
 * 修补（首帧仍要用服务端给的初始值），两者都不是「读一件小事」这个形状 ——
 * 等真有第二个消费方时再按那时的形状加。
 */
export function writeCookieItem(
  name: string,
  value: string,
  maxAgeSeconds: number,
): boolean {
  if (typeof document === "undefined") return false;
  try {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}`;
    return true;
  } catch {
    /* 同 `writeStorageItem`：记忆是增强，不是功能。 */
    return false;
  }
}
