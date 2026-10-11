## Fixed

- **裸 `pnpm dev` 起的 dev server，从 `http://127.0.0.1:<端口>` 打开会反复整页重载**（热更新静默失效）。两条本仓约定撞在一起：端点收口规定回环主机写 `127.0.0.1`（硬规则 20 / §12.14，Node fetch 会把 `localhost` 先解析成 `::1`），而 `scripts/dev.mjs` 裸跑时起的是 `next dev --turbo -p <port>`（**不带 `-H`**），Next 16 于是把 `localhost:<port>` 认成唯一的规范 dev 源 —— 从 `127.0.0.1` 那半边连 `/_next/hmr` 被判成跨源，**连接被直接撕掉**（实测该请求拿不到 101，Chrome 侧是 `ERR_INVALID_HTTP_RESPONSE`）。HMR 客户端连不上就整页重载，表现是「页面自己一直刷、侧栏点了没反应」，而不是一条读得出的错误。修法：`next.config.js` 补 `allowedDevOrigins: ["127.0.0.1", "localhost"]`，只放这两个回环名。
- **只有裸链路受影响**：启动器那条链（`scripts/dev-launcher.mjs` → `next dev … -H 127.0.0.1`）实测三种 `Origin`（含不带）全部回 101，所以桌面壳 / `tools/start/*` 一路本来就是好的 —— 这也正是它长期没被发现的原因：坏的那半恰好是 README 写给「纯前端开发」的入口。
- **判据**：`tests/dev-loopback-origins.test.ts` 钉三样 —— 这颗键在、两种回环拼法都在、**豁免面恰好等于这两个名字**（反向那条判的是集合相等而不是「没出现某个坏字符串」，`10.x.` / `*.local` / 带端口这些形态都漏得过后者）。摘掉键后三条各自红，已反向验过。
