## Fixed

- **启动后的「未连接」空窗期不再露出来（ISSUE #730）**：启动页探测到应用端口可响应就调
  `navigate_to_app`，而导航一发起主窗画面就离开启动页，直到应用画好首帧（dev 模式要等
  next dev 首次编译）这段等待里，WebView2 会先给空白、连接被拒时给内嵌的 Edge
  「无法访问此页面 / ERR_CONNECTION_REFUSED」——主窗又是无原生装饰（标题行前端接管），
  页面没画出来时连右上角的关闭按钮都不存在，用户看到的就是「窗口没有关闭按钮」。
  现由壳侧新增的**主窗首帧看护**（`watch_main_first_paint`）在这段时间注入加载占位，
  启动页（进度 / 日志 / 关闭按钮）保持可见；占位自带重贴定时器以对抗「错误页换掉整个
  DOM」，由应用根布局挂载时经 `clearLaunchLoadingStub()` 收尾，窗口交接时壳再清一次。
  `standalone` 模式不注入（内嵌 server 随壳一起就绪）。规范见
  `docs/standards/launch-and-build.md` §1.4 与 §5，回归测试见
  `tests/check-file-structure.test.ts` 的 ISSUE #730 用例。
