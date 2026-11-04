## Fixed

**镜像格 LFS 推送在「本地 ref 枚举不到」时回退 `--object-id`**（ISSUE #3146，现场 #3138）：

- `scripts/ci-github-mirror-push.mjs`：`git lfs push <url> HEAD` 有两处依赖「本地
  ref 可枚举」—— 按 ref 对账该推哪些对象、以及参数 `HEAD` 本身要能解析。平台合成的
  合并提交 / 工作区形态下这两件都可能不成立（现场 `Error getting local refs.`），
  而旧实现的下一动作话术却写着「改按 `git lfs push --object-id` 推」——**代码里没有
  这条回退**，话术指向一个不存在的出口。
- 现在 `LOCAL_REFS` 这一形**自动回退**：清单由 `git lfs ls-files --long` 按 **index**
  取（实测删光 `refs/**` 后它照样给得出 OID），不经任何 ref 解析，再用
  `git lfs push --object-id` 重推。回退通了就是通（原路径的 ref 枚举失败不构成结论）；
  回退也失败才 exit 1 不派发，话术说清「含 --object-id 回退」。
- 清单为空（本地压根没有 LFS 对象）⇒ 回退没有对象，按原失败交账并明说。
  认证 / 配额 / egress 那几类**不回退** —— `--object-id` 救不了它们。
- 新增导出 `lfsObjectIdPushArgs()` / `parseLfsObjectIds()`；`pushLfsObjects` 的读数
  多一位 `retriedByObjectId`（读数，不参与判定）。
- **LFS 那一族另起模块 `scripts/ci-mirror-lfs-push.mjs`**（参数表 ×3 + `pushLfsObjects`）：
  回退路径加进来后主文件顶穿了 900 行硬闸（§12.6 R5），按 `ci-mirror-failure-report.mjs`
  同一纪律「按职责拆出去、主文件再转出」，导入面一行没改。
- 用例：回退成功退 0 并派发、回退也失败退 1 不派发、清单空走原失败、非 `LOCAL_REFS`
  形态不回退，四条按行为写；已用「把回退分支短路掉」验证过它们会真红。
