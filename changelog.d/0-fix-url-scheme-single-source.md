## Fixed

- **「这个地址能不能交给外部程序」收成一处判据，并补上漏掉的第四个落点**（安全台账 A5 复算）。
  同一句「协议必须是 http(s)」此前在库里写了两份实现、四个落点，而其中**危害最大的那条没判**：
  `setting.openExternal` 的目标地址由请求方给，只过 `z.string().url()` —— 那道闸管的是
  「是不是一个 URL」，`file:` / `javascript:` / 自定义协议（Windows 的 `search-ms:`、`ms-msdt:`，
  本应用的 `comfyapp:`）全都算「是」。而 `cmd /c start "" <协议>:…` 是**直接把控制权交给
  协议处理器对应的本机程序**，`file:` 则是读本机文件。
  现在判据在 `src/lib/url-scheme.ts` 的 `isHttpUrl()`（按 `new URL()` 解析，一处定义），
  四条出口全部改吃它：`setting.trainerUrl`、`setting.comfyEmbeddable` 的两个地址、
  `llm.baseUrl`，以及 `openUrlInBrowser()` 本体 —— 拦在**发起 IO 之前**，非 http(s) 返回
  `{ ok: false, detail }` 且一次都不 spawn（这一层的既有失败形状就是这两个字段，
  前端原样显示，所以用户拿得到原因）。内部那两条（`comfyOpen` / `dbStudioOpen`）给的本来就是
  http 地址，加闸不改行为。
  顺带修掉那份前缀正则**两个方向**的实测错误：误拒合法的 `HTTPS://x`（大小写敏感），
  误放行 `http://␣␣` 与 `http://x y`（不是合法 URL，存进设置后每次连它都换回一句难查的连接错误）。
  `~/lib/comfy/comfy-embed.ts` 的 `isHttpOrigin` 改成转发到同一处（保留名字只为调用点读得顺）。
  判据：`src/lib/url-scheme.test.ts` 12 条、`src/lib/shell/open-in-browser.test.ts` 12 条
  （含「拒绝时一次都不 spawn」「URL 必须是独立 argv 元素」—— 后者守着那次 `"start"""`
  引号剥离事故不再回来）、`src/server/api/routers/setting.test.ts` 34 条
  （这一条**不 mock 地基**，测的是「路由没有绕开闸」而不是「路由调到了地基」）。
