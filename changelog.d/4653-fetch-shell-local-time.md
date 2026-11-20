## Fixed

- `fetch-daily-shell` 的构建时间按本地时区展示并保留 UTC 原值：此前原样打印 ISO 串（`…T11:50…Z`），与 CNB Release 页的北京时间（19:50）对不上，被误读成上午构建的（#4653）。
