## Fixed

- **依赖清单变更当天触发 Dependabot 巡检，不再等次日定时档（ISSUE #4432）**：`Dependabot triage (mirror)` 原先只有每日 03:00 定时与手动两口，master 上改了 `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock`（或 `package.json` / `pnpm-lock.yaml`）后，新告警最多要等 24 小时才被提单；现在 push 命中这四份依赖清单当场巡检一次（与 `package-desktop.yml` 同形的 `push: branches: [master] + paths`），告警随依赖图异步刷新、push 那一跑读不到 newborn 告警时由定时档兜底。
