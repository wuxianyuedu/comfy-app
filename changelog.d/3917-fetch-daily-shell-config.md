## Added

- **`pnpm fetch:daily-shell --config`：给「本地根本没有令牌文件」这条死路补一个建的入口（ISSUE #3917）**。
  用户级令牌文件（Windows `%APPDATA%\comfy-app\cnb-release-token`、跨平台
  `~/.config/comfy-app/cnb-release-token`）是**按需建**的凭据文件，缺省时一个都不存在——此前
  脚本只在 401 出口打印一条路径，人拿到的下一步是「我自己去猜目录建文件」。现在：
  - `--config [路径] --token <token>` 把令牌写进候选清单里的第一个（或显式路径），只写令牌本体
    （`0o600`、自动建父目录）；`--config` 的无值形态不吃紧跟的 `--token`，不会写出一个名叫
    `--token` 的文件；缺令牌值退 2、不落空文件。
  - 无令牌时（`--dry-run` 与下载两条路都算）逐条打印候选路径与「已有 / 不存在」——路径不存在
    是正常态，缺的是「它在找哪儿、怎么建」这两句；令牌本体一次也不回显。
  - 候选路径的 homedir 先从传入 env 取（`HOME` / `USERPROFILE`），`os.homedir()` 只当兜底：
    注入 env 验证时旧实现会指到真实用户目录上。
  - 判据补 5 条（`tests/fetch-daily-shell.test.ts`）：无令牌时念候选清单与状态、`--config` 写入后
    下载链能读回且不回显令牌、显式路径与旗标形态、缺值退 2、自动建父目录。
