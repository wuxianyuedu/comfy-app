## Fixed

- **`src/lib/comfyui/markdown.ts` 撤除文件顶部的 5 条 `no-unsafe-*` ESLint
  disable**：这条 disable 是全 lib 里唯一一处文件级关档，382 行的渲染器
  一次把 `no-unsafe-assignment` / `no-unsafe-member-access` /
  `no-unsafe-argument` / `no-unsafe-call` / `no-unsafe-return` 五条规则
  关掉——本意是「逐行 disable 太丑」，实际后果是这个文件以后引入真正 unsafe
  的消费时没有门禁会拦。撤除 disable 后跑 `eslint src/lib/comfyui/markdown.ts`
  只有 10 处真错误，且**根因同一**：`String.prototype.replace(re, callback)`
  在 `lib.es5.d.ts` 里签名是 `(substring: string, ...args: any[]) => string`，
  捕获组值全是 `any`。三个带捕获组的回调点位：
  · 链接替换 `(_, txt, url) => safeHref(url)` — 把 `url: any` 传进
  `safeHref(raw: string)`；
  · 自闭合 HTML `renderSafeInlineHtml` 第一段 `(whole, tag) => tag.toLowerCase()`
  与后续 `SAFE_INLINE_HTML[key]`；
  · 包裹型 HTML `renderSafeInlineHtml` 第二段 `(whole, slash, tag) => …`。
  三处统一改成显式 `(whole: string, tag: string, ...)` 标注，`any` 消失、
  eslint 全绿；未加抽象 helper（`replace(re, cb)` 是内建方法，
  套一层 `replaceAllG1` 之类只会把可读性换成一堆间接引用）。
  `markdown.test.ts` 14 条行为用例全绿，输出不变。
