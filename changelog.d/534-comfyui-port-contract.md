## Fixed

- **「配置了 ComfyUI 端口却像没配」：应用会静默连到另一个 ComfyUI 实例上**。默认端口此前有**四五份实现**，彼此从未对过：连接侧 `resolveComfyBase()`（`src/lib/comfyui/client.ts`）把 `comfyuiPort: 0` 判为「未配置」并用**硬编码**的 8188 作探测起点，而拉起侧 `resolveEffectiveLaunch()` → `buildSpawnArgs()` 同样把 `0` 当「未配置」、**不传 `--port`**，于是 ComfyUI 以它自己的默认端口启动；`lib/core/config.ts` 的 schema 默认值与若干错误文案里又各写了一遍 8188。单看每一处都「没毛病」，所以没有任何测试会变红 —— 表现也不是「连不上」这种一眼可见的错：8188 上往往真有个别的实例在应答（Comfy Desktop 常驻），兜底探测链的最后一项恰是窗口地址 :8000，于是探到了、但不是你要的那个实例，用户读到的是上传失败 / 端口漂移这类**现象**，根因被埋掉。现在默认端口单点定义在 `src/lib/app-settings.ts` 的 `COMFYUI_DEFAULT_PORT`，连接侧与拉起侧一律 import 它；`lib/core/config.ts` 的 ComfyUI 兜底地址改由 `src/lib/endpoints.ts` 的 `comfyUiBaseUrl()` 拼出；设置页 placeholder / 说明文案与错误建议里的端口改为运行时取值（空口不再各写一遍数字）。

## Added

- **ComfyUI 端口口径一致性门禁**（`scripts/check-comfyui-port-contract.cjs`，接入 pre-commit 与 CI）。它把这条契约做成**可失败的断言**：默认端口单点定义、连接侧与拉起侧共用同一常量、`buildSpawnArgs` 的「有效端口 > 0 才显式传 `--port`」口径、`endpoints.ts` 的地址拼装仍在、源码里不得再出现裸 `8188` 字面量（注释里解释历史口径的写法不受影响）。回归测试两层：`tests/comfyui-port-contract.test.ts` 锁契约本身（含「端口为 0 两侧落到同一个默认端口」这条），`tests/check-comfyui-port-contract.test.ts` 用临时仓库跑真脚本，断言该拦的拦、不该误伤的放过（注释、常量定义行）。
