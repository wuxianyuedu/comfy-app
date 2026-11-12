## Added

- **GA 桌包成品回传 CNB 站内，方便获取（ISSUE #3607）**：本地双击 `tools/build/build-all.ps1` 得 release 壳，诉求是「这步的产物能在 CNB 侧执行和获取」。此前 #3504 把实际构建迁到 GA `package-desktop.yml`，成品只落 GitHub（run artifact + 滚动 nightly Release），而 GitHub 对这条链只是镜像仓、用户在 CNB 侧拿不到包。现补齐最后一跳：
  - `scripts/ci-ga-desktop-relay.mjs`（GA 收尾步）：把**同一份**安装版（nsis / msi）与免安装版（portable zip）发到 CNB 的滚动 `nightly` Release。落点选 Release 附件（稳定下载 URL、按名字取、每天都指向最新一份），不选制品库（裸 exe/msi/zip 不适配）或 Issue 附件（随 PR 号找）。上传走 Swagger 逐格坐实的三步 —— 取 `asset-upload-url` → PUT 二进制到预签名 URL（不带 Authorization）→ `asset-upload-confirmation`（`ttl=0` 永久，滚动 tag 自己轮替）；`verify_url` 拆 `upload_token` / `asset_path` 按 CLI 明示口径。复用 `ci-ga-logs-relay.mjs` 导出的 `cnbRequest` 底座，不另写请求层（硬规则 24）。
  - `package-desktop.yml` 收尾加「回传成品到 CNB」step，排在 GH Release 之后（只读现成成品、不重跑构建），带 `continue-on-error: true` —— 回传失败只多一行读数、绝不反过来把「桌包打出来了」判红（同 #3437 口径）。令牌专用 `CNB_RELEASE_TOKEN`（`repo-release:rw`），不给 `CNB_ISSUE_TOKEN` 扩权。
  - **三态 + fail-closed**：缺令牌 / 仓库 / 一份成品都没有都退 2「没判过」，不是绿；上传三步缺一步即失败，不假装送达；`--dry-run` 一条网络不发；失败回话先脱敏（硬规则 17）。
  - **判据**：新增 `tests/ci-ga-desktop-relay.test.ts` 18 条（前提 / 成品收集不硬编码文件名 / verify_url 拆解 / 三步上传链 / PUT 不带 auth + ttl=0 / 脱敏 / dry-run / 出口给 CNB 站内取包地），`tests/no-platform-ci-config.test.ts` 桌包段从「三个落点」扩到四个并新增接线断言（点既有脚本 + continue-on-error + 专用令牌）。
  - **文档**：规范 `launch-and-build.md` §7.7 与生成态镜像同批补 #3607 现状横幅，`.cnb.yml` 桌包段、`package-desktop.yml` 头注同步订正「推荐取包地是 CNB 站内」。
  - ⚠️ 运行期依赖：镜像仓需配 `CNB_RELEASE_TOKEN`（`repo-release:rw`）secret；缺它时收尾步退 2「没判过」并逐条点名，不影响构建结论。
