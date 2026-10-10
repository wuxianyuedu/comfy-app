## Fixed

- **`/workspace` 链路的模型屏页头写着裸字面量 `title="模型库"`，而注册表里这一项叫「模型」—— 两名并存且没有任何判据会红**（ISSUE #1673，是 #1668 那一刀的收尾）。
  - **现场**：`src/components/studio/ModelLibrary.tsx`（路由壳 `src/app/workspace/page.tsx` 按视图 id `models` 动态挂载）。它与同一条链路的另一屏 `src/components/model/ModelLibrary.tsx` 是两处实现，后者早已走 `pageHeaderTitle("models")`，前者把名字留在了 prop 里。
  - **两条判据为什么都抓不到它**：① P86 锚的是**形态**（`.u-title-page` + `mt-1 text-sm` 同现），而这一屏**走了基元**、文件里没有那两件 —— 形态锚天然放行；② `page-name-single-source` 第 4 条锚的是 `<h1 …>纯文本</h1>`，基元之后字面量搬进了 **prop**（`title="模型库"`），锚里根本没有 `<h1>` 这个标签。两条判据的分工恰好把它漏在中间。
  - **处置只做一件事：把那一处接回唯一出口** —— `title={pageHeaderTitle("models")}`。这**不是**在给「`models` 要不要留一个全名」那条线选口径：那一格归 `viewLabel`，而实测它**只认形状** —— `模型库` 以 `label`（`模型`）开头、残下「库」一个字，按 `tests/page-name-single-source.test.ts` 第 2 条就是同义扩写，加不上去。所以 `models` 不设 `viewLabel`，页头与侧栏统一叫「模型」—— 这是判据已经定过的事，本次只是把漏掉的一处接上。

## Docs

- 规范 16 §16.2.4.73 末段新增「同一屏的第二条路」（ISSUE #1673）：两处现场、两条判据各自的盲区对照表、处置边界，以及**一条留给另一条线的缺口**——「prop 里的屏名字面量」这一类**当前没有执行者**，要不要补一条按 prop 取锚的判据不在本次范围。同段附**可复算的入口**（一份只认 `<PageHeader>` 的 `title=` 的循环，别用全库 `title="` —— 那会把 `EmptyState` / `Hint` / `Dialog` 的同名 prop 一起捞进来），实测现还剩**一处**同款：`ConsoleView` 的 `title="控制台"`，它与注册表那一项**正好同字**，属**同名不同源**（今天看不出来，注册表改名那天才会漂），一并留在现场。`docs/DESIGN.md` 的 Known Gaps 同款补一句指回去。
- 同章订正两处**会漂的份数**：§16.2.4.73 的「七屏」「这 7 屏」与 `PAGE_HEADER_CONSUMERS` 实际条数（**8**）对不上，改成不抄数字、指回那份常量（用例名已按 `PAGE_HEADER_CONSUMERS.length` 现算）。
- 同章订正一处**过期举例**：「与 `label` 真正不同义的全名是允许的（`models` → 「模型」/「模型库」那一类）」—— 这个举例本身就是第 2 条判据会拦的形状（以 `label` 开头 + 残 1 字），照它去加 `viewLabel` 会当场变红。改成按判据的**形状**口径重述（去掉前缀、真换个能多给信息的全名才走得通），并把 `models` 这一处作为实例写明。
