## Fixed

- **GA 桌包成品回传 CNB 首次真跑必挂（ISSUE #3611）**：`ci-ga-desktop-relay.mjs` 走「CNB 站内还没有 `nightly` Release ⇒ POST 创建」这一支时，请求体缺 `target_commitish`，服务端回 400 `{"errcode":2000001,"errmsg":"target_commitish is required"}`，回传步 `exit 1`，CNB 侧站内始终拿不到包。
  - Swagger `openapi.PostReleaseForm` 有 `target_commitish`（「目标提交哈希或分支名称」）这个 property，却没标进 `required`；`POST /{repo}/-/releases` 的 CLI 描述明写「需指定标签名称和目标提交，标签不存在时基于它自动建 tag」。PR #3608 按 schema 抄字段漏了它，假 fetch 又对 create 无条件返回 201，18 条判据全绿仍盖不住缺口。
  - `ensureRelease()` 创建 payload 补 `target_commitish`：缺省复用 `ci-github-mirror-push.mjs` 已导出的 `MASTER_REF`（默认分支 `master`），可由 `CNB_RELEASE_TARGET` 覆盖；**不用 `GITHUB_SHA`**（镜像仓 commit，CNB 仓未必有同一个 sha）。脚本文件头「上传链路」第 2 步与 env 清单同步订正，`package-desktop.yml` 收尾步注释同批说明。
  - 判据补 3 条（共 21 条）：① `cnbFetch` 模仿服务端对缺字段返回线上同形 400，创建 payload 必带非空 `target_commitish`；② `resolveDesktopRelayContext` 缺省 `master` / `CNB_RELEASE_TARGET` 覆盖 / 空串回落；③ `nightly` 首次创建（GET 404）走完整条链 —— create 带字段之后「取上传地址 → PUT → 确认」3 份成品各三步全绿，补上「create 一挂、后面三步从没跑过」的盲区。去掉字段的反面实测：2 条判据当场红。
  - ⚠️ 边界：本地流水线 token 无 `repo-release:rw`（真实 create 探针返回 403），真实端到端凭证仍由 GA 侧下一跑产生；本次交付不谎称「已验证送达」。
