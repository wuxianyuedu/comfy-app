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

  2. **平台日志的中文全是乱码**：

     ```
     [e2e-run] 璧� Playwright 鍓嶏細搴旂敤绔彛 绌� / 鏇胯韩绔彛 绌�
     ```

     标准的「UTF-8 被当 GBK 读了一遍」。病在 stage shell 这一层：Node 写 UTF-8
     字节 → PowerShell 拿 `[Console]::OutputEncoding`（中文 Windows 上 = CP936）去解
     → 再按同一个编码吐回平台（平台自己那条 `任务执行失败，返回码：1` 是好的，所以
     不是平台解码侧的问题）。处置：**每个 stage 的脚本都以
     `[Console]::OutputEncoding=[Text.Encoding]::UTF8` 开头**，`.cnb.yml` 头注新增
     第 6 条记这条形态与它的现场。

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

- **`ESLint 零警告` 与 `prettier 格式` 让位了一轮，当天就收回来了**：两项都跑得通，
  只是在「把 E2E 那两格调绿」的每一轮里都要白重跑一遍（节点侧 ESLint 256~274s），
  于是先按 `.cnb.yml` 里写着的恢复动作的反面登记进 `COMFYAPP_CI_DISABLED_GATES`，
  并把恢复条件写成一句话「**E2E 一绿就取消注释加回来**」。触发条件的那一跑是
  `cnb-h80-1k51ukj26`（整条流水线 success，34 个 stage：`浏览器安装` 0.7s /
  `E2E 关键流程` 51.3s），
  **同日按同一套动作恢复**：`.gates` 两段注释取消 → 名字挪回 `COMFYAPP_CI_GATES` →
  从停用清单删掉（那份清单现在只剩 `单元测试`）。**判据本身一字未动**：停用期间本地
  `.githooks/pre-commit` 的 `eslint --max-warnings 0` 与 prettier 棘轮照旧跑。

  记它的理由不是「改了两下」：一个 stage 被停用时**唯一**留下的痕迹就是这类条目
  （`.gates` 里的注释与 `DISABLED_GATES` 里的名字都不报错），所以两半都要写清楚，
  否则下一个人读到的是一份「既跑又停」的配置。

  注：`生产构建` **没有跟着停** —— 它是 `E2E 关键流程` 的前提（CI 下 webServer 走
  `pnpm start`，要 `.next` 产物），停掉它只会把那 133s 搬进 E2E 里，一轮不会变快。
