## Added

- **页面级像素基线的「录制输入面」从此显式登记，未登记的接口当场红（ISSUE #1620）**。
  起心动念是 #1620 里那句追问：「录的内容如果和返回的内容相关，不同环境很容易就不一样，
  不能随便一改录的内容就不一样了。」当时的处理姿势是**逐个手写 `freeze*`**，而一份 spec
  只会桩它「知道自己依赖」的那几格 —— 实测一份只桩了 2 格的首页 spec，真实链路上有
  **16 个** `/api/**` 请求，其余全由「这台机器的 DB / ComfyUI / 日志目录 / 网络」在答。
  它们**当时恰好**没进像素（被 mask 遮着、在浮层里），但没人知道是恰好：谁把某块 chrome
  挪出 mask 范围、或让某个降级态改成可见，基线就记住了那台机器的现场，而**当场不红** ——
  只在以后某次真差异里混进来，还指不出是它。

  机制分两半：
  · **运行时**（`e2e/visual/support/page-baseline.ts`）：新增 `watchRecordingInputs()`
  （在任何 `goto` 之前注册请求监听 —— `page.on("request")` 只抓注册之后发出的请求，
  而首屏那一批恰好是环境依赖最重的一批）与 `expectRecordingInputsDeclared()`，
  由 `settle` 收尾调用。本屏打过的 `/api/**` 逐个去 `RECORDING_INPUT_CONTRACT` 里找，
  **没登记的当场红并点名它的 URL**，附两条处置（封口 / 登记为 `masked` 或 `offScreen`
  并写清靠什么不进像素）。tRPC 批请求按**过程名**拆开（`/api/trpc/a,b` → 两条），
  所以「哪几个过程凑在同一批」这种调用时机的产物不影响判据。
  · **判据**（`tests/visual-recording-inputs.test.ts`，进固定清单）：每份 spec 都接了监听
  （没接时运行时判的是空集、永远绿）、每处 `goto` 都配了监听、登记表非空、已知的机器
  相关数据源还在表里（删条目比加条目更容易过 review，而删掉一条等于把那一格重新交还给
  「跑它的那台机器」）、每条都写了 `how` 与够长的 `note`。

## Fixed

- **`/api/production` 没桩 —— 画布的节点数由本机 DB 决定（ISSUE #1620）**。
  `ProjectCanvas` 挂载时把它返回的 `production.shots` 经 `materializeProductionShots()`
  **物化成画布节点**：有镜头就多节点。实测给这一屏喂两条镜头，`canvas.visual.spec.ts` 的
  「4 节点 / 3 边」断言**当场红**（变成 6 个）—— 也就是说在「建过表、且这个项目存过生产
  数据」的机器上录这份基线，录出来会是一张**多两个节点**的图，而容器里是 4 个。
  新增 `freezeProductionShots()` 钉成 `{exists: false}`（干净环境的真形态，
  `fetchProduction` 判的是 `data.exists === true`），取向与 `freezeComfyStats` 钉成降级态
  同源。同批把 `workflow.list` + `workflowModel.list` 也钉空（它们读本机 DB、前者还扫磁盘
  上的本地工作流根目录；当前靠「夹具里没有 workflow 节点」「没点过节点」两条同时成立才没进
  像素 —— 不留这个悬念），并把 canvas 那份内联的 `page.route` 换成 `stubTrpc` 一次登记。

- **`stubTrpc` 的批请求喂不进去**（同批修掉的一个既有缺口）：一个 URL 里凑了几个过程时，
  `stubTrpc` 只回**一个**结果，第二个过程的槽位解成 `undefined` —— 而它**静默、不报错**
  （与 ISSUE #1442 那族同源）。新增纯函数 `planStubResults()`：按 URL 里的过程顺序逐一取
  结果，**只要有一个过程没有主就整条 `continue()`**（半桩的批请求比不桩更坏），
  配四条用例（单发 / 批的顺序 / 缺主 / 非 tRPC 路径）。

## Docs

- **§11.8 新增「录制输入面」一节**：接口从隐含变显式登记这件事、三档处置
  （`pinned` / `masked` / `offScreen`）各自的含义，以及「`masked` 与 `offScreen` 不是安全、
  是这一档不判它」。同时补两条实测纪律：**tRPC 的桩必须一次登记进同一个 map**
  （同一个 URL 只能有一个 `page.route` 处理器），以及**「平台名相同」不等于「渲染相同」**
  —— `-linux.png` 担保不了字体栈（实测：另一个 linux 容器缺 CJK 字体时，同一份 spec /
  同一份基线差 1767 像素、整页中文字形不同，且 `-linux.png` 这个名字看不出这一点）。
  后者目前**没有判据**，只在文档里给出「先去看字体栈」这条动作纪律。
