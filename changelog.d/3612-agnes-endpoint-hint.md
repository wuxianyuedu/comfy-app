## Fixed

- **「测试连接」对填在官网域上的 Base URL 只说「密钥无效」**（#3612）：把 Agnes 的
  Base URL 填成 `https://api.agnes-ai.com/api/v1`（官网登录态的后端）时，探测对
  **任何**密钥都答 401 `Login expired`，界面归因为「密钥无效，或该密钥没有这个接口
  的权限」—— 密钥其实没问题，指错方向的归因会让用户反复换密钥。
  现在凭一份**当面核实过的厂商端点清单**（`src/lib/llm/provider-types.ts` 的
  `knownApiEndpointHint`，目前只收 Agnes：接口端点在 `https://apihub.agnes-ai.com/v1`）
  在两处开口：设置页 Base URL 字段下面当场指路（不用等测试失败）；三条探测链
  （测试连接 / 模型目录 / 实际调用测试）的非 2xx 归因在归因句之后补端点指路。
  只提示、不改写用户输入（与版本段提示同一口径）；对清单外的域一概不开口，
  不猜「这是不是控制台域」。
