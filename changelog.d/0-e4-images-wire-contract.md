## Added

- **台账 E4 的第二格契约判据：`tests/task-detail-images-wire-contract.test.ts`** ——
  `task.detail` 的 `images` 列集 ↔ 客户端镜像。这一格修之前的形状是
  `src/lib/media/task-images-client.ts` 里一处 `as unknown as` 加一个手写 `type`：
  类型擦除之后**运行时没有任何东西知道客户端读了哪几列**，所以服务端把 `localPath`
  改名、或那份关系装载换列时，表现不是报错而是**相册永远空**（每一行都被判成不合法丢掉），
  而 tsc / eslint / 那份只 `vi.mock("~/trpc/vanilla")` 返回固定对象的单测 / 覆盖率门槛全绿 ——
  与 E4 第一格（`task.list` 的 `videoPath` 恒 `undefined`、下载按钮一次没出现过）同形。
- **`task-images-client.ts` 的手写镜像换成 zod**（`taskImageRowSchema`），并抽出
  `parseTaskImageRows`（与 `video-queue-client` 的 `parseVideoRows` 同形）。这一处不是风格改动：
  这类判据需要一份**运行时可读**的形状才能比列集。窄化口径逐字照旧 ——
  `localPath` 非字符串整行丢弃、缺 `id` / 缺或 `null` 的 `isCover` 兜底成空串与 false
  （缺 id 的图仍要能在相册里翻页），而不是把整行丢掉。
- **两份契约判据共用一份实现 `tests/helpers/wire-contract.ts`**（`throughJsonWire` +
  `missingFromWire`）：第二份动手时若照抄那四行，就是 §12.12 意义上的孪生实现，
  而孪生的收口历来是两份一起漂。
- 判据钉四件事，缺一不可：① 镜像声明的每一列线上都在发（方向是镜像 → 线上，就是当初漏掉的那一维）；
  ② 反向 —— 线上发的列**不**全在镜像里（镜像是收窄，不是逐字复制；少了这条，①会被一份
  「把整行列全抄进镜像」的实现无痛满足）；③ 返回值来自真 handler 经一次 JSON 传输，
  顺序由服务端的 `orderBy(isCover desc, sortIndex asc)` 给、客户端不重排；
  ④ 反向验证 —— 把那一列改名，红的必须是「缺列 + 空相册」两个看得见的结论。
  另钉一格空相册不许串到上一条任务的图。
- 变异两刀各打在一半上（打完逐字节还原）：镜像多声明一列 → ①红并点名线上缺的是哪列；
  镜像退化成逐字复制线上列 → ②红。

## Fixed

- **`docs/standards/11-测试与可观测性.md` 的 §11.3 里那句 MSW 示例写的是 v2 的选项名**：
  `listen({ onUnhandledRequest: "error" })` 在本仓装的 3.x 类型里已经没有这个键
  （复算：`grep -rho "onUnhandled[A-Za-z]*" node_modules/.pnpm/msw@*/node_modules/msw --include="*.d.ts" | sort | uniq -c`
  只出 `onUnhandledFrame`），照文档抄会直接判类型红。改成真名，并把「怎么知道该用哪个名」留在文档里。
- **同一节那条「不要用 `vi.mock("~/trpc/vanilla")`」补了它真正的边界**：它禁的是
  「返回永不 resolve 的 pending 只做渲染冒烟」，不是「替掉传输层」这件事本身 ——
  两份契约判据 mock 的正是 `~/trpc/vanilla`，但把 mock 接回**真 router** 且过一次 JSON 传输。
  原先文档没有这一条例外，读起来与已落地的判据互相矛盾（口径按「谁答得了那一问」分，
  不按「用了哪个库」分）。
- **§11.11 那份「契约测试落点」表补上 zod↔API 这一族的两格**（此前只列 pino / 会话 / 审计，
  新判据落地后在文档里没有位置可找）。

## Changed

- 台账 E4 条目按今天的复量重写：原记「msw 仅 7 文件使用」两种口径都不符，而**不同口径本来就
  给不同数**（算「出现过 msw 的 API」与算「直接 import msw 包」差一倍）⇒ 份数不抄进正文，
  只留两条现取的命令；「用得少」本身不是缺陷。剩余没覆盖的 schema 按危害点名三处
  （远端模型的键名分叉、`generate.generate` 的入参、comfy state 的 REST 信封），
  勾态从 `[ ]` 改成 `[~]`。
