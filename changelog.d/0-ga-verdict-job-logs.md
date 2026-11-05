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
  - 全量日志**脱敏后落盘**到 `.comfy-ci/tmp/github-verdict-logs/verdict-logs.txt`
    （gitignore 内；每次回读先清空上一次），由 `.cnb.yml` 新增的「GA 失败日志附件」
    stage 用 `cnbcool/attachments` 传成 commit attachment（实测相对路径可用）。
- **「取不到」与「取到了但为空」分开读**：401/403（令牌缺 `actions: read`）/ 404 / 网络
  ⇒ 一行缺因（带 HTTP 状态）；200 空正文 ⇒ 「取到了但为空（0 行）」。
- **脱敏**：精确令牌值与 `ghp_…` / `github_pat_…` 形状一律 `<redacted>`，日志、异常、
  落盘文件三处都过这一跳。
- 请求那一层拆到 `ci-github-verdict-request.mjs`（文件大小硬闸 + 日志/判定共用）；
  `ci-github-verdict-read.mjs` 保留原导出，既有调用方不受影响。

## Fixed

- `check-ci-yaml-parse.mjs` 的 stage 形态判据接受**插件形态**（非空 `image` + 非空
  `settings`、没有 `script`），不再把 `cnbcool/attachments` 这类上传 stage 判成红；
  「只有 image、没有 settings」仍按缺 script 红（判据不是免检）。
