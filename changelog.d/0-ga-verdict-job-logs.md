## Added

- **GA 判决回读判红时回读失败 job 的完整 Actions 日志**（`ci-github-verdict-read.mjs`
  原来只拿得到 `conclusion`，看不到 job 级原因）：
  `GET /actions/runs/{run_id}/jobs` 取 job 清单与**失败 step 注解**，再逐个失败 job 取
  `GET /actions/jobs/{job_id}/logs`。
- **打印通道按 CNB 的真实上限设计**（2026-11-05 实测，build `cnb-5le-1k6l64o12`）：
  单 stage 日志封顶 **102400 字节**，超界时 stage 仍是 success、平台保留头部 +
  `The log length exceeds the limit(102400)` + 尾部（静默截断）；单行 8 KiB / 64 KiB 原样、
  1 MiB 被截到约 102398 字符。因此：
  - stage 日志只打**摘要 + 失败注解 + 失败 step 原始窗口**（预算 60 KiB，
    `STAGE_WINDOW_MAX_BYTES`），窗口不会被 stage 上限吞掉；
  - 预算是**整个 stage 共用**的，按剩余字节逐窗分配（第二个失败 job 的窗口拿的是剩下的
    那点，注解也计预算）—— 实测两条真实 run / 4 个失败 job 的回读，stage 正文合计
    **64,485 字节**，低于 102400；若每窗各拿 60 KiB，两窗就到 100 KB+，尾部那行
    「全量日志已落盘」会先被平台截掉；
  - 全量日志**脱敏后落一份本地文件**（`.comfy-ci/tmp/github-verdict-logs/verdict-logs.txt`，
    gitignore 内、每次回读先清空），并在每个失败 job 下打一行 **GA 的日志下载端点**
    （`GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs`，需 `actions: read`）。
- **全量也进 stage 日志：gzip + base64 + 分块（`日志分块 1/3` … `3/3` 三格）**。
  为什么不走「附件」：`cnbcool/attachments` 那类格是**插件**（`image` + `settings`），要
  docker，自托管节点没开容器能力 —— 实测 build `cnb-l4r-1k6lcffnv` 该格 0s 红
  `Runner does not enable Docker.`（此前那次「附件成功」的探针走的是平台池，不是这条
  条件路径），**必红的格不许留**，整格已删。为什么不「直接打全」：单 stage 封顶 102400
  字节且静默截断（同上）。所以：
  - 回读格把**失败 job**（不是整 run 全部 job）的脱敏正文压成 `chunk-<i>.b64`
    （每块 ≤ 90000 base64 字节，含折行与首部后单格实测 **91818 字节**，留 10 KiB 余量）
    + `manifest.json`（块数 / 印几块 / 整包 sha256 / 原文与 gzip 尺寸 / 拼回命令）；
  - `.cnb.yml` 固定**三格**（不搞几十个静态 stage），实测两条判红 run / 4 个失败 job 的
    正文 **616395 字节 → gzip 118375 → base64 157836 → 2 块**；超出三格时只印前 3 块并
    明念「其余见上面每个 job 的下载端点」（不静默丢）；
  - **可重建**：按 `chunk-1..N.b64` 顺序拼接（去换行）→ base64 解码 → gunzip → 核对
    sha256。已用真实日志端到端验过：拼回 616395 字节与原文**逐字相同**；
  - 这三格**不许红**：清单读不到 / 这一块不存在 / 块文件缺失，各念一行、退 0。
- **退码晚一格（`GitHub 判决判定`）**：CNB 的 stage 串行，回读格若直接退 1，后面分块格
  在判红那一形上根本跑不到（而判红最需要看日志）。所以回读格改 `--decision-out`
  写判定文件、退 0；判定格读它退真码，**读不到 ⇒ exit 2**（fail-closed，判不了就拦合）。
- **「取不到」与「取到了但为空」分开读**：401/403（令牌缺 `actions: read`）/ 404 / 网络
  ⇒ 一行缺因（带 HTTP 状态）；200 空正文 ⇒ 「取到了但为空（0 行）」。
- **脱敏**：精确令牌值与 `ghp_…` / `github_pat_…` 形状一律 `<redacted>`，日志、异常、
  落盘文件三处都过这一跳。
- 请求那一层拆到 `ci-github-verdict-request.mjs`（文件大小硬闸 + 日志/判定共用）；
  `ci-github-verdict-read.mjs` 保留原导出，既有调用方不受影响。

## Fixed

- 判红回读不再只给 `conclusion`：stage 里直接可见 run / job / step / 注解 / 失败窗口。
