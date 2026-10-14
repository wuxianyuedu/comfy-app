## Changed

- **根布局的 `metadata` 去掉脚手架残留（ISSUE #1889）**：`title` / `description` 一直是 create-t3-app 带过来的英文默认值，是个不该留在成品里的残留。现在 `title` 走 `template: "%s · Comfy-APP"` + `default: "Comfy-APP"`，品牌只在根布局收口一处 —— 子路由（如模型库）只声明自己那一段，最终标题与改动前逐字相同；`description` 换成实际用途描述。
  - **可见面如实记一笔**：桌面壳的窗口标题由壳侧显式设定（`src-tauri/src/lib.rs` 的 `WebviewWindowBuilder::title("Comfy APP")`），前端自绘的页签行也不读 `document.title` —— 所以它**不进桌面壳标题栏**；真正消费它的是**浏览器形态**（`pnpm dev` 那条开发链路，README 写明前端可在浏览器里调试）。立案时的描述（窗口标题/任务栏/地址栏）沿用了「Next 应用默认可见面」的印象，这里订正。
  - 刻意**不**补 `viewport.themeColor`：那颗 meta 管浏览器地址栏/窗饰着色，而桌面壳 `decorations: false`、窗口底色归 `tauri.conf.json` 的 `backgroundColor`，前端这层没有消费方 —— 不添没人消费的配置项。
- **CSP 从「每个响应重拼一遍」改成模块级常量（ISSUE #1889）**：`next.config.js` 的 `headers()` 原先每次调用都现拼一遍十来个片段的 CSP 字符串，而它的输入只有 `NODE_ENV`（取值只两种，`next dev` / `next build` 都在加载配置前定好）。现在算一次落成 `IS_DEV` / `SCRIPT_SRC` / `CSP` 三个模块级常量，`headers()` 只引用 —— 输出与原先逐字一致，纯省重复拼接。
- 顺带更新 `e2e/support/home-anchors.ts` 里已过期的那句注释（它拿 `Create T3 App` 当「标题不稳定」的例子，而那个值正是本次修掉的）。

## Tests

- `tests/app-metadata-and-csp-shape.test.ts`：钉住两件事的形状 —— 根 `metadata` 里不再有脚手架原样值、`title` 走 template、**没有**凭印象补回 `viewport.themeColor`、models 页只写本页那一段（自带品牌会被根 template 补成「· Comfy-APP · Comfy-APP」）；以及 `CSP` 是模块级常量、`headers()` 里没有退回逐请求 `join`、dev 放行 `unsafe-eval` 而 prod 不许、三条承重条目（frame-src / ipc 通道 / frame-ancestors）仍在。**只在代码对象字面量里判、不判全文**：讲「它曾经是脚手架残留」的注释不该被判红，否则假判据会逼人删掉解释。变异核过：`headers()` 退回拼装、`title` 退回脚手架值、models 页自带品牌，三处各自被拦、恢复后全绿。

## 验证记录

- **CSP 等价性是实测的、不是推的**：`SKIP_ENV_VALIDATION=1` + 指定 `NODE_ENV` 各跑一次 `import("./next.config.js")` 再取 `headers()[0]` 里那条 CSP，与改动前**逐字节相同**（prod 352 字节 / dev 366 字节）。
- **本改动对 client 体积的贡献为 0**：提交前真跑过一次 `pnpm run build`，`next build` / standalone 剔私 / 数产物 / executor-host 冒烟全绿；唯一红是 **bundle 预算**（217 文件 / 2247.6 KB gzip 超基线），已复算为 `baseline-red`（§13.6.2）—— 在干净 HEAD `b179b669`（即本改动的基点）上、无任何改动重跑同一构建，读数**逐字相同**，而基线 `f03ccf0e` 已落后 52 次提交。该红与本次改动无关，按 §13.5.4 记一条写明理由的豁免。
