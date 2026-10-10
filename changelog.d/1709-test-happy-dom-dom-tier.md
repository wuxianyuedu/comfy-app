## Changed

- **DOM 档的默认环境从 `jsdom` 换成 `happy-dom`，jsdom 变成逐文件的例外档**（ISSUE #1709，规范 §11.17.2.1）。分档形状不变（`node` 档 + DOM 档两条目录 glob），只是 DOM 档那一格的 `environment` 换了实现：绝大多数渲染用例（渲染一个组件、断言点了会回调）用不上 jsdom 的边角行为，而 happy-dom 起一个 window 明显更便宜。
  - **实测**（同一套 DOM 用例面 449 文件 / 1310 条；全量 676 文件 / 8517 条、`maxWorkers: 8`）：全量墙钟 **89.70s → 79.43s**，其中 `environment` 占比 **21% → 13%**（−38%）。DOM 档单独跑 449 文件 **24s 全绿**。
  - **例外按文件走**：落在 jsdom 特有行为上的 8 份用文件头 `// @vitest-environment jsdom` 改档（文件头优先级高于 project 的 `environment`，实测）。每份的头里都写明了具体是哪一条 API / 行为 —— `Node.prototype.nodeName` 是返回空串的基类桩（DOMPurify 的 `lookupGetter` 沿原型链命中的正是它，整段消毒退化成「只留文本」）、CSSOM 不认 `color-mix()` 与 `rgb(r g b / a)`（赋给 `style.*` 时整条声明被丢掉）、`clientWidth` 落在实例上不可 `spyOn`、`getAnimations()` 不推进动画时钟（base-ui 的 `useAnimationsFinished` 不 settle ⇒ 弹层永不卸载）。
  - ⚠️ 第一族**失败的方向不是红**：「剥掉 `javascript:` / `onerror`」那批对抗性断言在消毒退化成只留文本之后**照样报绿**。换 DOM 实现时要专门回看这一类「断言某东西被剥掉」的用例。
  - **不给 happy-dom 打地基补丁**：`Node.prototype.nodeName` 那条可以用一行 `Object.defineProperty` 在 `tests/setup.ts` 里补掉（实测补完 DOMPurify 就能用），但那是在测试侧改写第三方库赖以工作的 DOM 基础语义 —— 补丁一失效表现就是消毒静默退化，而全仓库不会有任何东西变红。

## Fixed

- **测试 tRPC client 的 URL 不再写死 `http://localhost:3100`**（ISSUE #1709）。那个常量是按 **jsdom 的行为**挑的：jsdom 的 `fetch` 不做同源检查，跨源请求 MSW 照样拦得到。happy-dom 的 `window.fetch` 会先做 SOP 判定，于是请求**根本没到 MSW** —— 表现是集成用例集体「数据永远不回来」，而报错里一个字都不提 origin。
  - 收口成 `tests/helpers/test-trpc.ts` 的 `testTrpcEndpoint()`：按 `window.location.origin` 拼（jsdom 与 happy-dom 下都是 `http://localhost:3000`）⇒ **恒为同源**，两种环境行为一致；`setupTrpcServer()` 的 handler 本来就是 host 无关的 `*/api/trpc/*`。生产侧的对应物是 `~/trpc/base-url` 的 `getBaseUrl()`（DOM 宿主下同样取 `window.location.origin`），这里是它的测试版对偶。
  - 7 处调用点（`tests/helpers/renderWithProviders.tsx`、集成用例、5 份 hook 用例）同批改掉。

## Added

- **`check-test-environment.cjs` 认三档，并把 jsdom 例外列成清单**（ISSUE #1709）：
  - 「矛盾」与「冗余」的定义按新的四格细化（`node` 档 + DOM 头 = 正当；`node` 档 + `node` 头 = 冗余；DOM 档 + `node` 头 = 矛盾；DOM 档 + 基本档自己的环境 = 冗余），**第五格**（DOM 档 + `jsdom` 头）是正当例外、**列清单不判红**。
  - 每档的 `environment` 从配置**解析**而不是写死档名 —— 写死等于判据持有第二份「哪个档是什么环境」的真相，配置换了实现它会静默放过（同 §11.17.4「判据自己不许静默降级」）。
  - 通过时打印「本档例外：N 份用例用文件头改到 jsdom」并逐个点名，**不参与退出码**：例外会悄悄涨成「半个套件都在 jsdom 上跑」而没人发现，本档的收益也就还回去了。
- **门禁自测补第 5 格的三条**（`tests/test-environment-gate.test.ts`，14 → 17 条）：DOM 档里的 jsdom 头「不红且被列进例外清单」、「不算冗余」（变异判据：并进冗余会当场把仓里 8 份正当写法判红）、「DOM 档里写**基本档自己**的环境仍是冗余」（换个写法绕不开例外清单）。
  - ⚠️ 本轮改分档时在该文件**当场漏过一次**：`node` 档里的 `node` 头那条冗余判据被 `continue` 提前跳过，17 条里红了 1 条 —— 「新加一档，相邻两格的口径要逐个回看」不是理论。
- 规范 **§11.17.2.1**（两个 DOM 实现的三族差异表、例外登记口径、不给 happy-dom 打补丁的理由、实测收益）；§11.17 头部口径、§11.17.4 五格表、§11.17.5 与 `docs/guides/TESTING.md` 同批更新。
