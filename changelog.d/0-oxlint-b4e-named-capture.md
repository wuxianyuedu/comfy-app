## Changed

- **B4 子批 5：20 份 / 66 处 `eslint/prefer-named-capture-group` 清零**（判决面删掉这 20 份路径行）。
  命名组 45 处（时间戳/文件名解析按 `groups.<name>` 重写解构，`[1]` → `groups?.<name>`），
  非捕获组 21 处（组值无人读，如 media-kind 扩展名判据、logrus 前缀匹配）。
- 改动集中在 `src/lib/log/`（runtime-log-file 名字解析、log-run-packs、log-ansi、log-cli-json）、
  `src/lib/comfyui/`（runner-state 栈帧、status 启动器、workflow-detail-io 宽高比）、
  `src/lib/media/`、`src/lib/llm/`、`console-guard`、`envfile`、markdown 开标签扫描。
- 修复一处类型收窄（envfile 的 `groups.value` 显式判空），`tsc --noEmit` 复跑通过。
- 台账：B4 行改「清账中（子批1–5：205 份 / 659 处已清）」。
- 清账总账：#3181（本批挂 `Refs`）。
