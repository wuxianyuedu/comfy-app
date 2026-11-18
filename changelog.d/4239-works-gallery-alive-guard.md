## Fixed

- 作品库 `load` 回调无卸载守卫：快速切视图时卸载后 setState（#4239；对照同一数据源的 use-sidebar-projects 有 alive 守卫，同类 hook 口径不一）。补同款守卫。用例：卸载后断言不落地。
