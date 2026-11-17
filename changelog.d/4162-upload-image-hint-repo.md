## Fixed

- **截图工具与文档里的 `cnb issues upload-image` 提示补上显式 `--repo`（ISSUE #4162）**：
  该命令的 `--repo` 缺省回落环境变量 `CNB_REPO_SLUG`，本检出通常没设它 ——
  两者都缺时请求发给错误目标，服务端回一句误导性的 `Resource not found`，
  看不出缺的是 repo（#4138 交付截图时实测两次）。现在截图脚本的用法说明与
  运行期提示、`ui-screenshot` 指南、§13.12 的命令样例都显式带
  `--repo moon-read/comfy-app-t3`；帮助文本的回归用例同步钉住。
  （应用内反馈链路本就显式传 repo，不受影响；cli 侧「缺 repo 先自查」的
  改进属外部 CLI，另在单子里说明。）
