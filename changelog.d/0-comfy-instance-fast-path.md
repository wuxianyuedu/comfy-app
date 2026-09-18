## Fixed

- **设置页的「安装形态」不再等秒级运行态探测**：它此前与运行态挤在同一个响应里 —— `setting.comfyStatus` 先跑 `getComfyUiStatus()`（进程表查询 + 端口探测 + 解释器反查，本机空载实测进程表一步 0.5s，负载下整条链到 10s 级），于是打开设置页要等十几秒才看到「桌面版 / 便携版」徽标，「端口 / 启动参数」输入框也在这段时间里亮着、随后才被隐藏；而形态本身是**纯文件系统判定**（10 次 `existsSync`，实测 ≈1.4ms），还每 10s 跟着重探测再判一遍。现在形态与「路径是否已配」拆成独立查询 `setting.comfyInstance`（`describeComfyInstance`，fs-only），与首屏 `setting.get` 同批返回（毫秒级），改路径 / 启动参数保存后再 refetch；`comfyStatus` 只负责运行态。排查条目见规范 §5，回归测试 `src/app/(main)/settings/hooks/use-settings-page.test.ts`（让运行态探测一直悬着，断言形态已就绪）与 `src/lib/comfyui/instance-kind.test.ts`。
