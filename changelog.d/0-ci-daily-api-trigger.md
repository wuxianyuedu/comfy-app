## Added

- 每日档多一个 **CLI / API 触发口**（`.cnb.yml` 的 `api_trigger_daily`，与 04:00 那一跑和
  手点那个按钮**引用同一个 `*daily_gates` 锚点**，七格逐字相同）。
  触发：`cnb build start-build --repo <slug> --branch master --event api_trigger_daily`。
- 为什么按钮那个口不够：手点要一双手。修完 `每日单元测试` 那格之后想立刻复验时，编码代理
  打不开那个按钮，而服务端**拒绝**用 CLI 发 `web_trigger_daily`
  （`--event` 只认 `api_trigger` 或其前缀，实测 400
  `Event must be 'api_trigger' or start with 'api_trigger_'.`）。剩下的两种都不是修法：
  等人手点，或等到第二天 04:00。
- 它不需要声明文件（与 `web_trigger` 靠 `.cnb/web_trigger.yml` 与事件名成对不同），
  也没有 `reg` 那一层「哪些分支显示按钮」—— 分支由 `--branch` 给，缺省是主分支。
  事件名前缀是**服务端硬要求**，所以判据判 `^api_trigger` 而不是整串名字：写成
  `daily_api` 那一类在配置解析期一个字都不报，而那条流水线永远没人能触发。
- 判据随之从「两个触发口同一份清单」升到**三个**（`tests/no-platform-ci-config.test.ts`），
  锚点引用数从 4 升到 5（少引用一条 = 那条悄悄回落到计费的平台池）。
