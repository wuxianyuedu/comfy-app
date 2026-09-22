## Fixed

- **启动页出现后自己挪一下位置**：`setup_splash_window` 在声明式窗口（`tauri.conf.json` 的 `splash`: width / height / center）已经建好并居中之后，又无条件 `set_size` + `center()` 一次 —— 而两条居中的口径不同：**声明式窗口按客户区居中**，`center()` 按**外框**居中，resizable 窗口的不可见边框让两者整整差一条边框（2560x1600 / 150% 下实测 (722,602) → (711,595)），而 `setup` 比窗口显示晚约 1.3 秒才执行到那里，用户看到的就是「黑框出现一会儿后自己挪了一下」。现在**只在显示器上限真的把尺寸收窄了**时才动这个窗口，尺寸未变时连 `set_size` 都不调（`splash.html` 的 `applyCompact` 注释里已写过同一条教训：不允许出现第二个人去摆启动页窗口）。

- **启动期整屏闪一下**：窗口状态插件在「窗口就绪」时还原应用窗口几何，其中 `maximized: true` 的分支是 `window.maximize()` —— Windows 上这个调用**自带显示语义**，于是把还该隐藏的主窗显示了出来（实测 t=+2.7s 出现一个铺满屏幕的可见主窗，95ms 后才被建窗流程重新隐藏）。改为 `skip_initial_state("main")`，由壳在**首次显示那一刻**（`show_main_window_without_focus`）调 `apply_saved_main_window_state` 套用记忆的几何：最大化落在「窗口本来就要显示」的时刻，不再有显示副作用，**不抢前台**的语义也不变（实测日志 `shown without stealing focus (focused_after_show=false)`）。

- **上一条的绕法被显式禁止**：「提前套用几何 + 随后立刻 `hide()` 回去」看着可行，实测**更差** —— `maximize()` 自身要跑几百毫秒（要等窗口过程把消息处理完），窗口可见 379ms，比原缺陷的 95ms 还久。回归判据 `window_startup_tests`（`src-tauri/src/lib.rs`）用源码形态钉住三件事：位移不许无条件发生、几何不许在窗口还该隐藏时套用、上述绕法不许再写回来。
