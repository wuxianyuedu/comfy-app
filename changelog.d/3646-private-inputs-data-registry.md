## Fixed

模式契约的本机覆盖没进分发产物的减法名单（ISSUE #3646）。

- **减法侧补登记**（`scripts/standalone-private-inputs.mjs` 的 `PRIVATE_INPUTS`）：
  `data/workshop-mode-contracts.json` 逐条点名，并写清「谁在运行期读它」——出厂件
  该读的是项目默认那份（`src/lib/workshop/mode-contract-defaults.json`，被
  `model-mode-contract.ts` 静态 import ⇒ 编译进产物），本机覆盖只属于「这台机器上
  额外改的那点东西」。
- **同族一并补齐**（这一族排查的结果）：`data/workshop-api-settings.json`
  （**含上游 apiKey**；写入方是 `src/lib/workshop/api-channel.server.ts` 与 MCP 侧
  `src/server/workshop/api-channel.ts`）与 `data/workshop-comfy-settings.json`
  （`src/server/workshop/comfyui.ts` 记的 checkpoint 与工作流模板）此前同样没登记，
  现在一并进名单；`data/` 下剩下的三处**目录**（`data/backups/` 的整库快照、
  `data/workshop-outputs/` 与 `data/workshop-compositions/` 的产物）按**目录**点名。
- **减法的删除动作改成能删目录**（`stripPrivateInputs` 的 `rmSync` 补
  `recursive: true`）：那三处是目录，而 `rmSync` 不带 `recursive` 撞上目录会抛
  `ERR_FS_EISDIR` —— 那一刀会在「减法」这一跳当场崩掉。
- **减法不顺着符号链接删**（新增 `traversesSymlink`）：删目录要 `recursive`，而产物里
  的 `data/` 万一是个链接，**顺着递归删会删掉开发机上的那一份**（开发机的
  `data/backups/` 里躺着整库快照，被删的却是产物）。判法与 `stripForbiddenShapes`
  同源：逐段 `lstat` 判**父段**，撞上链接就整项跳过。叶子本身是链接时删的是链接
  本身（实测目标文件仍在），那一格是安全的。
- **回归**：`tests/standalone-runtime.test.ts` 钉四件——「名单里逐个点名」、
  「`stripPrivateInputs` 真删一次」（文件与目录各走一遍）、「产物里的 `data/` 是
  链接时开发机那一份一个都不许少」。模式契约那条的名字直接取写入方自己的路径常量
  （`MODE_CONTRACTS_REL_PATH`），登记名与落盘名漂了会当场红。
- **口径补进规范**：`docs/standards/launch-and-build.md` §7.3 记下 `data/` 这一族的
  登记规则（逐条点名 + 与顶层默认拒绝那第二道网的关系 + 为什么这一族不向禁忌清单
  补形状）。

**升级方会看到什么不同**：**产物内容不变**——顶层默认拒绝（ISSUE #1217）本来就
把产物根那一整个 `data/` 目录剪掉了（实测：减法跑完 `.next/standalone/data` 不复
存在），所以这几份此前并没有真的随桌包出去。本刀补的是**逐项那一层减法网**与它的
登记口径：① `data/` 这一族在名单里从此完整（文件与目录都登记了），规则与「谁在运行
期读它」写进了规范；② 将来 `data/` 若被放行（例如桌包改为自带一份默认配置随包），
这几份仍不会被带出去；③ 减法侧多了一道「不顺着符号链接删」的护栏 —— 这一条修的是
**开发机数据被误删**的隐患（今天靠「`data/` 在产物里是真实目录」这个事实兜着）。
开发检出里的本机文件**不受影响**（减法只作用于构建产物）。
