## Changed

- **`.gitignore` 新增忽略 `.qoder/`**：Qoder IDE 会在仓库内生成 `.qoder/`（本地会话记忆、索引与 IDE 配置），属于每台开发机各自产出的本地产物，不入版本库。此前未登记，用该 IDE 打开本仓库时 `git status` 会出现一批本应忽略的未跟踪文件，容易被误提交。现与同类的 `.workbuddy/`（IDE 会话记忆）放在同一段「agent 工具链本地产物」下，写法一致。
