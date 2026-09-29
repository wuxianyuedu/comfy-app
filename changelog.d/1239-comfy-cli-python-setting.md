## Added

- **新增设置项「comfy-cli 解释器」，桌包真出图不再要求用户碰环境变量**（ISSUE #1239，口径与 `comfyuiPath` 同形：**用户自备 + 设置页指路径**）。任务是通过 comfy-cli 提交给 ComfyUI 的，需要一个装好 comfy-cli 的 Python 解释器；而桌包**不随包** Python（百 MB 级环境 + 版本矩阵不该进安装包）。
  - 落点优先级：**设置项 `comfyCliPython` > `<cwd>/python-venv/comfy-cli/{Scripts|bin}/python(.exe)`**。设置项的**默认值**取 `COMFY_CLI_PYTHON`，所以「给壳进程设环境变量」这条老用法照旧生效（与 `COMFYUI_PATH → comfyuiPath` 完全同形），开发检出也可以什么都不填。
  - 「找不到解释器」的提示**按形态分叉**：开发检出里给那三条 `venv` + `pip install` 命令（可执行），桌包里改成指向「设置 → 创作后端 → comfy-cli 解释器」并提示保存后点「重试」。此前桌包用户看到的是 `pip install`——那是把开发者出口当用户出口（与 #1216 里那句「执行 pnpm db:push」同一种错）。分叉判据用**文件**而不是环境变量（`pnpm-lock.yaml` 在不在；产物护栏明令不许随包锁文件），与 §1.5 / §7.6「环境开关会撒谎，文件内容不会」同取向——**不能**用 `scripts/dev-launcher.mjs` 判，那份是运行期脚本、随桌包一起出去。
  - 失败建议同时进唯一口径的建议表：`error-advice.ts` 新增一条规则并**排在最前**（报错原文带 Windows 绝对路径，会被后面的「模型缺失 / not found」按子串误抢）。
  - 解释器落点与提示文案收在纯叶子 `src/lib/comfyui/comfy-cli-python.ts`（同 `raw-ui-only-nodes` 的先例：为这一行去 mock 整条派发链不值），用例直接喂值覆盖两支优先级 × 两个平台 × 两种形态。

## Fixed

- **桌包里照提示填完解释器、点「重试」要等宿主重启才生效**（ISSUE #1239，与上一条同批修 —— 是那句「保存后点重试」逼出来的）：`getSettingsSync()` 的进程内缓存只判「有没有缓存」，而桌包拓扑里**写设置的是内嵌 server 进程、读设置的是执行宿主进程**，两边各一份缓存 → 宿主在第一次取值时就把空值钉住；实测同一个 `未找到 comfy-cli Python 解释器` 在宿主不重启的情况下复现。缓存的失效判据改成**文件指纹**（`mtimeMs` + `size`，与 `comfyui/localWorkflows.ts` 的校验和备忘同口径）：磁盘上的设置一变、下一次取值就重读；指纹没变仍走缓存（不是把缓存改成「每次取值都读盘」）。开发检出侧行为不变（读写同进程，`saveSettings` 当场更新缓存，并把指纹对齐到自己刚写的这一份）。
