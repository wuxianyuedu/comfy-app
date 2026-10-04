## Fixed

- **全站正文不再落在浏览器默认字体上（#1434）。** `@theme inline` 里那行 `--font-sans: var(--font-sans)` 与 `@theme` 的真定义重名：inline 块不向 `:root` 发射变量，于是 `font-sans` 工具类内联成一句指向空气的自引用 —— 实测当时 `getComputedStyle(documentElement).getPropertyValue("--font-sans")` 返回空串，`body` 与各级标题的计算字体是 UA 默认的 `"Times New Roman"`，设计里那串 `Geist → PingFang SC → Microsoft YaHei → Noto Sans SC` 一次都没用上。换台机器、换个浏览器语言，正文外观就跟着变。
  - 编译产物侧的直接证据：级联求解器报 `token 引用成环：--font-sans → --font-sans`。
  - 为什么一直没被拦住：那条「别名不得与项目 token 重名」的铁律**执行者只覆盖了一个命名空间** —— 判据取块时写成「从 `@theme {` 切到 `/* Immersive` 为止」，而那条评论在块**内部**第 56 行就出现，于是扫描面一直只剩前 26 个 `--color-*`，字体/容器/间距那一半从来没被比过。判据长得像在全查、实际只查了一角。

## Changed

- **同一条铁律的第二个漏网也一并收掉：`@theme inline` 里的 `--color-card: var(--card)`。** 它把 `@theme` 的项目 token `--color-card` 静默顶成 `var(--card)`，与 ISSUE #672 删掉的 primary / accent / muted / border 四行同一个形状。实测今天两值恰好相同（浅 `#ffffff`、深 `#16161c`，编译产物里逐一核过），所以删它是**零视觉变化**；留着则是「改 `--color-card` 改不动」——下一次有人调卡片底而屏上不动时，这行就是那个查半天的原因。`bg-card` 照样编得出来，来源就是那颗项目 token。

## Tests

- 判据的覆盖面从「只认 `--color-*`」放宽到**任意自定义属性**，取块改成按花括号配对（`braceBlock`）；另加一条「判据自己的视力表」：扫描面里必须看得见 `--font-sans` / `--container-narrow` / `--color-card`，将来谁再把块切短，这条先红，而不是让判据静默空转。
- 新增 T5（编译产物侧）：`--font-sans` / `--font-heading` / `--font-title` / `--font-mono` 在两态都解得到具体值、不留未展开的 `var()`；正文那串必须含项目写的 CJK 回退，标题档必须含 `Sarasa Gothic SC` 且与正文不同源；`--font-heading` 确实转发到正文那串。
- 新增一条真浏览器判据（`e2e/theme-token-consumers.spec.ts`）：读 `getComputedStyle` 判 `--font-sans` / `--font-title` 在两态解析非空、`body` 的计算字体含 `Geist` 与 `PingFang SC`、且**不是** UA 默认衬线。标题档用页内挂一个 `font-title` 探针元素来判 —— 不依赖「这一屏恰好有 h1」（`/login` 上就没有，实测取到空串），也不用为找标题去导航到更重的路由。
- 反向验证（两条都做了实物证）：把 `--font-sans: var(--font-sans)` 塞回去 → 产物侧 5 条判据同时红（T2 的重名 + T5 的四条字体链），浏览器那条红在「浅色：--font-sans 解析为空」这句上。改回后 44 条产物判据 + 7 条浏览器判据全绿。
- 一次环境漂移的定性：改完后 `tsc` 报了 4 个**我没碰过**的文件（`onUnhandledFrame` 不存在）。先复算基线再怀疑自己 —— 是本地 `node_modules` 还停在 vitest 4.1.11 而 master 已升到 5.0.3（#1445 那批依赖升级），`pnpm install` 后归零，`package.json` 与锁文件一个字没动。没有为此改任何判据或源码。
