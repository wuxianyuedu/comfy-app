/* 「这个地址能不能交给外部程序」的协议判据 —— 只允许 http / https，一处定义。
 *
 * 为什么单独一处（规范 §12.18 复用优先 / §12.12 不许跨文件复制实现）：
 * 同一句「协议必须是 http(s)」此前在库里写了四遍，而**该判的地方没判**：
 *   · `~/lib/comfy/comfy-embed.ts` 的 `isHttpOrigin()` —— 用 `new URL()` 解析后比
 *     protocol（唯一一份「按解析结果判」的正确形态）；
 *   · `setting.trainerUrl` / `setting.comfyEmbeddable` 的 `base`+`hostOrigin` /
 *     `llm.baseUrl` —— 三处各写一份 `/^https?:\/\//` 正则。
 * 正则那份有两个实测缺口（两个方向都错）：`HTTPS://x` 被它**误拒**（大小写敏感，
 * 而那是合法的 https 地址），`http://␣␣` 与 `http://x y` 被它**误放行**（前缀匹配
 * 不是解析，串根本不成其为一个地址）—— 实测见 `url-scheme.test.ts` 最后一条。
 * 更要紧的是覆盖面：`z.string().url()` 的入参形态允许 `file:` / `javascript:` /
 * 任意自定义协议，而 `setting.openExternal` 这条**把控制权交给系统浏览器**的路径上
 * 谁都没判 —— 请求方给什么协议就往外抛什么（见 `~/lib/shell/open-in-browser`）。
 * 台账 A5 当年补的是「服务端会去 fetch 的那两个地址」，漏了「交给 OS 打开的地址」——
 * 同一族、同一口径，缺的正是「判据只写一次」。
 *
 * 为什么按解析结果判而不是正则：`new URL()` 是唯一能把「是不是一个 http(s) 地址」
 * 问清楚的口径（协议名大小写归一、畸形串直接抛错）；不合法一律 `false`，
 * 让调用点自己决定「给 400」还是「不发起 IO」。 */

/** 该地址是否可以交给外部程序：必须是合法 URL，且协议为 http 或 https。
 *  `file:` / `javascript:` / `data:` / `mailto:` / 自定义协议（`comfyapp:`、
 *  Windows 的 `search-ms:` / `ms-msdt:` 等）与畸形串都返回 `false`。 */
export function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
