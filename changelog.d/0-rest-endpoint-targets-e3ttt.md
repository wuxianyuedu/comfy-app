## Fixed

- **画布里那些「看不到图」的位置，代理 handler 根本不存在：`/api/images` 与 `/api/file/<name>` 实测 404**（台账 E3‴）。
  地址的形状收在 `src/lib/media/media-url.ts` 的 `comfyImageUrl()` 一处（那件事是对的），但它指向的
  handler 在基线迁移那次提交里没带过来 —— 于是浏览器打过来必然 404，而调用点一句 `catch {}` 或
  `MediaThumbnail` 的空 `src` 就把它咽成「没有图」：画布 IMAGE 输入的预览、工作流图片预览、
  项目产出缩略图、训练素材缩略图**常年空态，`pnpm test` 与 `check:all` 一路全绿**。
  实测（起本机服务逐条 curl）：`GET /api/images?filename=…` → **404**、`GET /api/file/x.png` → **404**，
  而同一条链上 `GET /api/trpc/project.list` → 200。
  - `/api/images` 补回那个不在的 handler（`src/app/api/images/route.ts`）：本机代理 ComfyUI 的
    `/api/view`，复用现成的 `getView()` 与 `contentTypeForPath()`，判据顺序 = 会话 → 文件名形状 →
    类别枚举 → 上游状态。失败**分三相**：上游 404 → 404（与「这一格本来就没有文件」同形）、
    上游别的码 → 502、连不上 → 503 且体里带 `hint=comfyui-unreachable`（ComfyUI 没起来是常态，
    界面要能显示「未连接」而不是画一个碎图标）。
  - 响应头 `private, max-age=60`：两条独立理由叠在一行 —— 响应取决于「你是谁」（`public` 等于
    授权共享缓存代读，口径同台账 A13），而 ComfyUI 的 `input` 目录会被同名上传覆盖（不许 `immutable`）。
  - `/api/file/<name>`（训练素材缩略图）**不补第二扇门**：它与 `/api/images` 是同一件事，
    改吃 `comfyImageUrl({ filename })`，媒体地址的形状因此仍然只在 `media-url.ts` 一处。
  - 修完之后实测：`?filename=nope.png&type=input` → **503 + hint**（本批之前是 Next 发的 404，
    两种 404 在状态码上根本分不出来）、缺 `filename` → 400、`filename=../../x.png` → 400。

## Added

- `getView()` 的失败现在带状态码：新增 `ComfyViewError`（`src/lib/comfyui/client.ts`）。
  原来只有 `Error("getView failed: 404")`，调用方要分相就只能**读消息** —— 消息一改判决就错。
  消息本身保持原样，`executor-finalize` 那类只判「拿不到就抛」的调用方零感知。

## Tests

- `tests/rest-endpoint-targets.test.ts`（新判据，进 `scripts/affected-tests.mjs` 的固定清单）：
  `src/**` 非测试代码里以引号紧接 `/api/` 开头的每个字面量，必须命中 `src/app/**` 目录形状推出的
  某个 route handler。段数要对齐（少一段就是 404），`[x]` 吃一段、`[...x]` 吃剩余全部（也吃零段），
  `${…}` 当通配段；`` `${base}/api/prompt` `` 这种前面是 `}` 的是外部服务地址，不进扫描面。
  两类**长得像地址但不是地址**的走带原因的显式登记表 `NON_REQUEST_ADDRESS`，且**双向不陈旧**
  （字面量没了还留着 = 红，登记的路径其实有 handler = 红）：`/api/trpc` 是 RPC 通道基址
  （真实请求一律 `/api/trpc/<ns.proc>`，实测那条 200、基址本身没人去拿），`/api/ws` 是 ComfyUI
  自己的 WS 路径（拼在 `ws://<comfy host>` 上）。
  反向验证：往 `media-url.ts` 塞一条 `/api/nope-endpoint/x` → 恰好主断言红并点名文件；
  把登记键换成 `/api/gone-already-fixed` → 主断言与陈旧断言各红一条。
- **判据装机时自己先错过一次**（记下来是因为它会重现）：递归收集抄了别处的写法，跳过名为 `generated`
  的目录（产物根在仓库根时是对的），于是 `src/app/api/generated/[...path]` 整个从路由表里消失，
  `/api/generated/…` 被判成没有落点。现在只跳 `node_modules` 与 `.next`，理由写在函数上。
- `src/app/api/images/route.test.ts`（11 条，四项门槛满档）+ `client.test.ts` 补 `getView` 三支
  （地址组装、非 2xx 带状态码、连不上不包成 `ComfyViewError`）。

## Docs

- 台账 E3‴ 关闭（四条的处置各归各位：`/api/skills` 改吃 `skill.list`、`/api/images` 补 handler、
  `/api/file/<name>` 收成同一个入口、`use-workflow-detail-loader.ts` 那条**只是 URL 形状的
  sessionStorage 键**改成请求身份三元组并把 `CACHE_KEY_PREFIX` 的 `R7` 升一档）；
  §11.2.1 与 `docs/guides/TESTING.md` 里指向 E3‴ 的措辞改成「判据已装成硬闸」。
