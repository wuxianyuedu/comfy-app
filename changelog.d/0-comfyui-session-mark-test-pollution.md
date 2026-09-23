## Fixed

- **测试不再把夹具会话写进真实 `log/services/`**（副作用是启动时报出「上一次 ComfyUI 会话…却没有退出记录」的**假**告警，用户读成「ComfyUI 莫名退出」）：`src/lib/comfyui/lifecycle.test.ts` 的 mock 说明符写成 `vi.mock("../log-paths", …)`，而真实模块是 `~/lib/log/log-paths`（`src/lib/log/` 下）——该说明符解析不到任何文件，`vi.mock` 对这种情况**不报错**（工厂注册在无人 import 的路径上），于是 mock 静默失效、真实模块照用：夹具会话（`python -s /x/main.py`）被写进仓库真实的 `comfyui-runtime.log` 与 `comfyui-last-session.json`，留下一条「有开始、没结束」的记录，下一次真机启动经跨会话对账便报出「上一次 ComfyUI 会话（pid=未知）开始于 …，却没有退出记录」——而那个会话从未被拉起（它没有任何 `comfyui-keepalive-*.log` 输出文件）。

  修法：说明符改为真实模块，落盘目录改指系统临时目录；并新增门禁 `tests/test-mock-targets.test.ts`（剥注释后扫描全仓 `vi.mock` / `vi.doMock`，可解析的说明符必须命中真实文件，否则红），防止同类「测试全绿、真实环境才炸」的死 mock 回潮。规范 §5 已补「这条是假阳性」的对照条目。
