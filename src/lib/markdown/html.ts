/**
 * 「HTML 串 → 消毒后的 HTML 串」的唯一出口。
 *
 * 为什么单独一个文件、而不是把 `DOMPurify.sanitize` 写在 `render.ts` 里：
 * DOMPurify 需要一个 **DOM 窗口**，这决定了两件与渲染逻辑无关的事 ——
 *
 *   1. **本模块的宿主范围**：它只能在浏览器或 jsdom 下跑。纯 Node 宿主（Next 的
 *      route / 脚本）拿到它会立刻抛「没有 window」，那是**位置错**而不是数据错，
 *      应该由调用边界挡在前面，而不是让调用方拿到一个运行到一半才炸的函数。
 *   2. **懒初始化 + 钩子注册**：`createDOMPurify(window)` 会探测一遍浏览器特性，
 *      在模块顶层跑等于每次 import 都付一次；URL 协议白名单（见 `sanitize-config`）
 *      也必须**只注册一次**，否则钩子会随实例成倍堆积。
 *
 * 消毒口径（哪些标签 / 属性 / 协议活着）在 `sanitize-config.ts`，**不在本文件** ——
 * 那才是会随需求变的部分，而「怎么拿到一个配好的 DOMPurify 实例」不该跟着改。
 */
import createDOMPurify from "dompurify";

import { createSanitizeConfig, isAllowedUrl } from "./sanitize-config";

/** DOMPurify 的实例类型（`createDOMPurify()` 的返回）。 */
type Purifier = ReturnType<typeof createDOMPurify>;

/** 会带 URL 的属性 —— 逐个过协议白名单。 */
const URL_ATTRS = [
  "href",
  "src",
  "cite",
  "action",
  "formaction",
  "poster",
  "xlink:href",
];

let cached: Purifier | null = null;

/** 取（并缓存）配好的 DOMPurify 实例；宿主没有 DOM 时抛出可读的错误。 */
function purifier(): Purifier {
  if (cached) return cached;
  if (typeof window === "undefined") {
    throw new Error(
      "markdown/sanitize：DOMPurify 需要 DOM 宿主（浏览器或 jsdom）；" +
        "纯 Node 侧（Next route / 构建脚本）请不要 import 本模块。",
    );
  }
  const instance = createDOMPurify(window);
  /* `afterSanitizeAttributes` 挂在**已经剪枝之后**：钩子拿到的 `value` 是 DOMPurify
   *  归一过的结果，因此这里不需要再处理 `java\tscript:` 这类转义绕过。 */
  instance.addHook("afterSanitizeAttributes", (node) => {
    /* 钩子的签名是 `Node`，但 DOMPurify 只对 Element 调它（属性挂在元素上）。
     *  类型侧用 `instanceof` 收窄而不是 `as Element` —— 断言不会做运行时检查，
     *  而这里真的需要一次检查（DOMPurify 的钩子签名将来若放宽，断言会静默放过）。 */
    if (!(node instanceof Element)) return;
    for (const attr of URL_ATTRS) {
      const value = node.getAttribute(attr);
      if (value === null) continue;
      if (!isAllowedUrl(value)) node.removeAttribute(attr);
    }
  });
  cached = instance;
  return instance;
}

/**
 * 把一段 HTML 过一遍白名单，返回**可安全插入 DOM** 的串。
 *
 * 输入应当是 `render.ts` 解析出来的 HTML；换成别的来源也安全 —— 这正是把这条通道
 * 单独留出来的意义：消毒的成立不依赖上游做了什么。
 */
export function sanitizeHtml(html: string): string {
  return purifier().sanitize(html, createSanitizeConfig());
}
