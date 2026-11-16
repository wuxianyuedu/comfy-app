## Added

- 每日纯壳回传时同发一份构建信息附件 `ComfyAPP-shell-build-info.json`
  （构建时间 / commit / run / 大小 / sha256，ISSUE #4056）：`ci-ga-desktop-relay`
  在纯壳 `ComfyAPP-shell.exe` 上传后随发；`fetch:daily-shell` 取壳时按同一 tag
  同址取回并展示「构建时间 · commit · run」，且对到手 exe 做 sha256 与大小对账
  —— 不一致（nightly 滚动覆盖导致 exe 与清单不同批）会明说；旧 nightly 没有该
  附件时降级指到 Release 页，不影响壳本体。
