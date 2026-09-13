## Fixed

- **启动页一出现就自己最小化进任务栏**（用户没点任何按钮，只能再从任务栏还原回来看启动进度）：启动页脚本在加载时调 `probeWindowCommands()`「探测壳兜底命令是否就位」，但 IPC 命令没有 dry-run——`invoke('win_minimize')` 是真的执行，启动页刚显示就把自己最小化了。已删除该启动期探测；壳是否过期改由用户真正点最小化 / 关闭按钮时的三条互补路径判断（窗口 API / 内联 onclick / 壳命令，全部失败时消息区给出可见提示）。注意：启动页是编译期内嵌资源，本修复随重编壳（`cargo build --release --features custom-protocol`）生效。
