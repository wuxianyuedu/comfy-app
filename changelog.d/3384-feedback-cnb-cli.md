## Added

- **反馈一键提单（ISSUE #3384，承接 #3371）**：应用不内置 CNB 凭证，改为
  在运行时探测环境中可执行的 `cnb` cli（身份取进程 `CNB_TOKEN` 或本机
  `cnb login` 登录态）。可用时「提交到仓库」一键建单，并把反馈包里的
  截图与诊断 zip 上传到该 Issue 的附件评论；不可用或失败一律回退到
  「复制正文 + 打开新建 Issue 页」，每格都有可见提示。
  落点：`src/server/feedback/cnb-cli.ts`（探测 / 建单 / 传附件，复用
  `executable-resolve` 与 `killProcessTree`）、
  `src/app/api/feedback/publish/route.ts`（只收服务端自造的包名、拒路径遍历）、
  `src/lib/feedback/feedback-client.ts`（探测与提交网络层）、
  `src/components/feedback/`（按钮与结果展示）。需求口径见 FR-MC-05。
