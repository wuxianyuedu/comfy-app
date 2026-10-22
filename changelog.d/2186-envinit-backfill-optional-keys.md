## Added

- **`pnpm env:init` 现在会往已有 `.env` 补「本仓后来新增的键」（ISSUE #2186，规范 §13.10.10）**：
  #2175 落地的提单留痕取自 `.env` 的 `COMFYAPP_DEV_HANDLE`，但那一格**传不到任何已有检出** ——
  `.env` 已 gitignore（入库的是 `.env.example`），而 `env-init.mjs` 对已存在的 `.env` 是
  「必填三项非空 ⇒ **整份跳过**」。当场读数：同一远端下这台机的四份并行检出里，
  `branch2` / `branch4` 有 `.env` 而**都没有**这一行，`branch1` 连 `.env` 都没有，
  只有本检出配了 ⇒ 那两份现在跑 `pnpm ship` 只会念「按规范去 `.env` 加一行」，
  而**没有任何一条命令替他把这一行补上**。这不只是这一个键：`COMFYAPP_PORT` / `LOG_LEVEL` /
  `MCP_HTTP_PORT` 每一族「后来加上的可选键」都卡在同一处。
  现在那一档改成「**必填齐也照样补缺**」：只把 `.env.example` 里未注释、而 `.env` 里完全没有的键
  按原样值追加，**已有键一律不覆盖、不重排、不动注释**（「不覆盖你的配置」那句旧承诺一字未改）。
  两条边界写进代码与规范：① `.env.example` 里这一格从**注释形态**改成**显式空值**
  `COMFYAPP_DEV_HANDLE=""` —— 空值 == 没配（`readDevHandle` 判非空，#2175 已有用例钉着），
  所以「有这行没填」与「没这行」念出来是同一句话，而只有未注释的键才进补齐面；
  ② **注释形态的可选键永不被提升成真值** —— 把 `# COMFYAPP_PORT="3100"` 补成 `3100` 会改行为：
  端口口径是按检出路径推导到 3200~3999（launch-and-build §1.1），钉回固定值正好打散并行检出。
- **顺带修掉一个相邻缺口**（量的时候撞见的，不是猜的）：旧 `fill()` 只做**行内替换**
  （`^KEY=.*$`），所以一份「整行没有 `BETTER_AUTH_SECRET`」的 `.env` 会被判成「必填项为空」、
  被念成「已就地补齐」，而那一行根本没被补出来。现在缺失的必填项走**追加**，值仍由那一份
  单一定义点生成（`launcher-core/standalone-runtime-env.mjs` 的 `newAuthSecret` /
  `OAUTH_PLACEHOLDER` —— 不在第二处造密钥，同 §12.12），且写完复核一次 `hasRequiredValues`，
  话术只点名补了哪个键、**不回显密钥值**。`.env` 的解析也只有一份：
  新增那两档用的是 `env-preflight.mjs` 的 `parseEnvFile`（不是第三次写正则）。
- **`pnpm ship` 那句「没配」的读数现在带得上门牌号**：一台机器四份检出时，
  「去 `.env` 里加一行」指不出是哪一份 —— 现在念的是这一份检出的绝对路径 +
  整行缺失时的下一动作（`pnpm env:init`）。仍只是**读数、不参与退码**（与 #2175 同一条纪律）。
  回归见 `tests/linux-env-bootstrap.test.ts` 新增三条（只补缺不覆盖 / 注释键不被提升成真值 /
  必填整行缺失补得出来且密钥不进日志）与 `tests/ship.test.ts` 的 `issueAuthoring` 那一条。
