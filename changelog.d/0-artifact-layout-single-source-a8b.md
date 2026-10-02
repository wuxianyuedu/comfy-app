## Fixed

- **「合成成片」对每一条镜头必败**（台账 A8 第二段）。库里 `filmShot.videoPath` 的值就是
  `TaskImage.localPath`，而那是执行器用 `taskOutputUrl()` 写的 `/api/generated/…`；
  `compose-steps.ts` 的 `clipPathOf()` 只剥前导斜杠、**不剥 `api/` 段**，于是算出
  `<cwd>/public/api/generated/…` —— 那个目录不存在，ffmpeg 报找不到输入，去字幕重试仍失败，
  最后收成一句「镜头 N 归一化失败」。同一条错在 `task.delete` 里出现过一次（A8 当年修的正是
  那一处），**第二处实现活了下来**；而 `compose-steps.test.ts` 旧的一条把这个错形状
  `expect(...).toBe("/proj/public/api/generated/…")` 钉成了期望 —— 用例在替 bug 签名。
  现在解析只有 `output-paths.ts` 一处（`artifactDiskPath`：`/api/generated/…` 与历史留下的
  `/generated/…` 两种形状同答案、坏百分号编码判成「不是产物地址」而不是抛 `URIError`、
  越界返回 `null` 让调用点处置），调用点在起 ffmpeg **之前**就说清是哪一条镜头、哪个地址。
- **一处越界判据弱一档**：`workshop/media-source.server.ts` 自己那份地址→磁盘映射用
  `abs.startsWith(GENERATED_DIR)` 收边界，同级的 `generatedX` 目录会被算作根内；
  改用共用判据（`path.sep` 收边界）。顺带它原来是**模块级常量**（import 期取 `process.cwd()`），
  现在按调用取。
- **`comfyapp://open` 的 PowerShell 允许根从此与 TS 侧的产物根成对**：
  `scripts/comfyapp-open-folder.ps1` 写死的 `..\public\generated` 是全仓第七份副本，
  而且在所有 TS 检索面之外 —— 搬根那天它不会跟着动，协议处理器会指着空目录 refuse 掉一切。

## Added

- **产物布局的单一出处判据** `tests/artifact-layout-single-source.test.ts`（固定守护清单
  14 → 15）：`src/` 里不许再出现第二处「产物根 / 产物地址 / 地址→磁盘」。四条一起判：
  零存量（五种被禁形状，先剥注释再扫，因为注释里正当会出现被禁的叙述本身）、
  扫描面非空且唯一出处确实在面里（空输入上「零违规」长得就像「收口了」）、
  五种形状各有一个实例真能被照出来（照不出的那条是装饰）、跨语言成对判据
  （ps1 的允许根按 `$PSScriptRoot` 实解析一次必须等于 `generatedRoot()` —— 比的是绝对路径，
  不是「去掉 `..` 之后的段数」，写成 `..\..\public\generated` 段数一样）。
  反向验证两条各红各的：塞回一份 `path.join(process.cwd(), "public", "generated")` →
  判据点名那份文件；把 ps1 改成 `..\..\` → 只有成对那条红。
- **子层与地址前缀也收到同一处**：`materialsRoot` / `filmsRoot` / `filmBgmRoot` /
  `ARTIFACT_URL_PREFIX` / `artifactUrl`（`src/lib/media/output-paths.ts`）。
  被用例钉住的一条对外承诺是：**磁盘根将来搬到哪，`/api/generated` 都不能变** ——
  它写在库里那些 `localPath` 里，改了等于历史产物全部读不到（这正是 A13 残留那条
  「把产物根搬出 `public/`」能做的前提）。
- `output-paths.test.ts` 补 7 条（16 → 23），核心是一条**同源往返**：往临时目录按
  `taskOutputDir()` 落一个真文件，再用写进库的 `taskOutputUrl()` 解析回去，断言
  `fs.existsSync` 为真 —— 项目任务与非项目任务两种布局各跑一次。
  「形状对不对」从此不靠读代码判断。`compose-steps.test.ts` 那条替 bug 背书的断言
  换成三条（两种 URL 形状同答案 / 越界与非产物地址返回 null）。
- 台账与规范同步：A8 加第二段（含「断言替 bug 背书」这条教训的出处与判据落点）、
  A13 残留那条改写成「只剩搬这一件事」并列清四件配套动作（历史文件迁移 / `src/proxy.ts`
  的 rewrite 去留 / 三处 UI 文案 / 产物层那道卫生账 ——
  `build-desktop.mjs` 无 filter 整树拷 `public/**`，而两道允许清单都把 `public` 放行、
  注释写明的理由正是「生成图落地目录」，所以构建机上攒下的产物会跟着桌包分发；
  搬出 `public/` 之后新根不在任何允许清单里，这条自然关掉）；
  §11.2.1 配套清单加到九条（用例的期望值要从语义推，不能从实现抄）。

## Changed

- 七份副本改吃同一处定义：`src/lib/media/materials.ts`（含它自己那份包含判据）、
  `src/lib/workshop/media-source.server.ts`、`src/server/film/compose-film.ts`（四处 join +
  自己写的成片地址）、`src/server/film/compose-steps.ts`、`src/app/api/film/bgm/route.ts`、
  `src/lib/comfyui/firstframe.ts`、`src/app/api/materials/route.ts`（REST 孪生的地址）。
- **顺手补了两个零执行者的文件**（改它们却没有执行者 = 白改）：
  `src/lib/workshop/media-source.server.test.ts`（7 条：产物根内真文件 / 两种 URL 形状同答案 /
  同级 `generatedX` 不算根内 / 越界 / 非产物地址 / 内联 data URL）与
  `src/app/api/film/bgm/route.test.ts`（5 条：落点由 `filmBgmRoot()` 派生且后缀不重复 /
  无会话 401 / 白名单外 400 / 缺 file 400 / 非 multipart 400 —— 后四条都断言「一次都没写盘」）。
  两组用例都把 `process.cwd()` 顶到临时目录或假根：**谁再手写一份落点，就会写到根之外，当场看得见**。
  `firstframe.test.ts` 那条成功路径的断言从 `stringContaining("generated/…")` 收紧成
  整条绝对路径，并补一条「地址不合法就不读盘、不上传」。
- `vitest.config.ts` 两处同批登记四个入口（`compose-steps` / `bgm route` /
  `media-source.server` / `firstframe`），门槛取实测下限，**没盖到哪些行写在注释里**
  （`media-source.server.ts` 只有 35/30/30/35：`http(s)` 拉取与 `resolveMediaDataUrl`
  两族仍零执行者，那是 E7 的账，登记低档是为了让「新增未覆盖」看得见）。
