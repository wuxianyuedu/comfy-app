## Fixed

- `.env` 的 `COMFYAPP_PORT` 取值从「`Number.parseInt` 吃前缀」改成「整串必须是十进制
  整数」（新增 `parseDotEnvPortValue()`，`scripts/app-port.mjs`）。此前 `COMFYAPP_PORT=3100abc`
  / `3100.5` 会被 Node 侧读成 3100，而 Python / Rust / PowerShell 三侧对同一个值判「未配置」
  —— 两边按不同端口启动，表现为启动页一直停在「等 dev server」（ISSUE #821 的同一个失效，
  入口从「壳不读 .env」换成「四侧对同一个值的理解不一致」）。前导 `+` 与首尾空白按另三侧
  实测形状收，Unicode 数字位不收；门禁与用例不再另抄一份判定，统一走这一个出口。
- `scripts/check-app-port-vectors.ps1` 补齐 `envVectors`：此前 PowerShell 侧只跑路径推导那一组，
  「四侧读同一份 `.env`」实际只有三侧在判 —— 而 PowerShell 恰是历史上最容易漂的那一侧。
