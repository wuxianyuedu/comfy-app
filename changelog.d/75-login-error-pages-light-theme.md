## Changed

- **登录页不再是「整屏固定深色 + 极光」的独立暗色品牌页（ISSUE #75）**：`src/app/login/page.tsx` 整屏写死 `bg-[#030014]`，卡片、输入框、分隔线、第三方按钮全部是 `bg-white/N` / `border-white/N` / `text-white/N` 暗色叠层——切到 Light 后主题开关对登录页完全失效。现整屏改 `bg-bg`、极光与 `AuroraBackground` 同一口径两态取值（浅色下 opacity 大幅调低且不用 `mix-blend-screen`），卡片/输入框/分隔线/按钮全部改语义 token。错误页与 404 此前已 token 化。同步在 `globals.css` 的「固定暗色清单」与规范 03 §3.6.1 写明「本应用没有任何界面是暗色品牌页」，把登录页列进「已明确不属于固定暗色」的反例清单，避免回退。
