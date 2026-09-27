## Fixed

- **安全加固那一批留下的三处过期断言**（`src/server/api/routers/workflow.test.ts`、
  `src/lib/llm/server.test.ts`）：`fix(security): batch1 hardening` 改了两处行为，用例没跟上，
  在 master 上红了一批（隔离跑也红，不是并发假红）。三条都按「代码是有意改的」重算，
  不放宽任何一道闸：
  - `create` 现在先过**导入路径闸**（只允许 `LOCAL_WORKFLOWS_PATH` / ComfyUI workflows
    目录之下的文件），而这两条「本地文件导入」用例的 fixture 写的是 `C:/wf/…` —— 根外的
    路径在闸上就被拦下，根本走不到要验的分支（名称回退为文件名 / 失败透传错误消息）。
    fixture 挪进一个登记的允许根里（用例内设置 `process.env.LOCAL_WORKFLOWS_PATH` 并在
    `afterEach` 还原），两条继续锁原口径。
  - **顺手补上那道闸自己的用例**：根外路径 → `BAD_REQUEST` 且 `importFromLocalPath`
    **不被调用**（能报路径就等于能读别人家目录里的 json，「拦下」与「拦在哪一步」都要钉住；
    反向验证过：把闸拿掉这条即红）。此前它一条覆盖都没有。
  - `getConfigForClient` 给客户端的形态里密钥一律被剥掉（顶层与远端条目都从 `null`
    变成不下发值），断言按新形状重算，并加一条 `out.apiKey` 为 `undefined` ——
    「本地=字符串 / 远端=对象」的类型区分与「不外泄密钥」是两件事，两条都要看得见。
