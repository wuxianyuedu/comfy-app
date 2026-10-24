## Fixed

- **平台侧三件事一起收口**（ISSUE #1966，现场 `cnb-cdt-1k51s6mf1`）。它们的共同点是
  **只在平台上红 / 只在平台上乱**，本地一条都复现不了。

  1. **`E2E 关键流程` 红在一个 `@` 上**（8.5s）：

     ```
     error: option '-g, --grep <grep>' argument missing
     ```

     `script: node scripts/e2e-run.mjs --grep @critical` 里那个 `@critical` 在 stage
     shell 那一层就没了 —— `.cnb.yml` 头注写着「脚本语言是 PowerShell」，而
     `@critical` 在那里是**给 `$critical` 的 splatting**（变量不存在 ⇒ 展开成空）。
     改成 `--grep=@critical`（`@` 不再是某个 token 的第一个字符，bash / cmd /
     PowerShell 下都原样传过去），并在 `tests/e2e-python-preflight.test.ts` 里钉住
     「不许写回空格那版」。

  2. **平台日志的中文全是乱码**：现场那条「起 Playwright 前」的读数（原文见
     `e2e/support/preflight-ports.mjs` 文件头）在平台日志里呈现为 GBK 误读形态、
     完全不可读。（ISSUE #2257 之前这里存着那份乱码字面 —— 后经核对它是**二次转码**
     产物，并不逐字，已换成本句说明；乱码这件事由说明承担，不由存进去的字面承担。）

  3. **`浏览器安装` 绿了（1.1s）**：上一跑自取装好的那一件跨跑还在落点上
     （`ms-playwright` 在 workspace 之外），于是走了「已装，跳过下载」的快路 ——
     顺带说明前一跑的自取是真的把东西落到了那个点上。

  ⚠️ 两处判据跟着放宽的是「入口排在第几个词」而不是判据本身（脚本开头多了一句编码
  设置）：`tests/ci-env-probe.test.ts` 与 `tests/no-platform-ci-config.test.ts` 现在
  从**整段命令里**找 `scripts/…`，并各自正向判一句「编码设置还在不在」。

  ⚠️ 顺手被咬的一口：第一版把 `script:` 的值写成 `[Console]::OutputEncoding=…` ——
  YAML 里 `[` 开头的纯量是**流式序列**，整份 `.cnb.yml` 当场解析不过（prettier 报
  `SyntaxError: Unexpected scalar at node end`），而平台侧只会表现成「流水线起不来」。
  定稿是 `$enc=[Text.Encoding]::UTF8; [Console]::OutputEncoding=$enc;` 两句。
  改配置的语法判据是免费的：`pnpm exec prettier --check .cnb.yml`。

## Changed

- **`ESLint 零警告` 与 `prettier 格式` 临时停用**（`COMFYAPP_CI_DISABLED_GATES`）：
  两项都跑得通，但在「把 E2E 那两格调绿」的每一轮里都要白重跑一遍（节点侧 ESLint
  256~274s）。**判据本身一字未动**（本地 pre-commit 照旧跑它们）。

  ⚠️ **恢复条件是两条，缺一不可**：① `E2E 关键流程` 一绿；② **平台日志的中文可读**。
  ① 当天就成立了（`cnb-h80-1k51ukj26`：整条流水线 success，`浏览器安装` 0.7s /
  `E2E 关键流程` 51.3s），于是**只按 ① 恢复过一次**；而 ② 不成立 —— 这两项真红时最该读
  的那几行全是乱码，等于把「每轮多花 5 分钟」换成一个**读不出原因的红**，**同日退回**
  （PR 关闭、分支删除；停用的两半一件没动，退回代价为零）。恢复动作仍与 `.cnb.yml`
  里写着的一致，等 ② 成立再走一遍。

  ⚠️ 连带订正了 ② 的说法：**两个嫌疑人都被实测否掉了**，逐条都是读数说话 ——
  ① 控制台输出代码页 `936 → 65001`：四行探针逐字未变 ⇒「`chcp` / 以 65001 启动 runner」
  不是解法；② 宿主 ANSI 代码页**也已经换成 UTF-8**（那台机勾了「使用 Unicode UTF-8 提供
  全球语言支持」**并重启过**）：四行探针**仍然逐字未变**。
  加上同一份日志里那组对照 —— **runner 自己打的行是完好中文**、子进程输出的每一行都是
  「UTF-8 按 CP936 解」⇒ 解码发生在**子进程输出那一跳**，用的是**不与宿主联动的 CP936**。
  所以机器侧那条路（原「首选」）**不成立**；仓库侧只剩一条：**让每个字节以 CP936 出口**。
  读数与判读见规范 §13.5.3.5「第二次探针」「第三次」。

- **`合并形态复核` 补上控制台输出编码设置**（master 合并复核那条流水线里的唯一步骤）：
  它是全仓**唯一**没钉 `[Console]::OutputEncoding` 的 `script`。补上它**不改变今天的
  读数**（抓取端按宿主 ANSI 代码页解），但它让那一步不再依赖「控制台代码页恰好是多少」
  这个**继承来的**状态 —— 而那台机器上刚刚把这个值改过一次。

  注：`生产构建` **没有跟着停** —— 它是 `E2E 关键流程` 的前提（CI 下 webServer 走
  `pnpm start`，要 `.next` 产物），停掉它只会把那 133s 搬进 E2E 里，一轮不会变快。
