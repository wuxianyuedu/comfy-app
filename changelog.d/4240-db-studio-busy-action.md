## Fixed

- 设置页 Drizzle Studio 启停回调的 setStarting/setStopping 无卸载守卫：启动耗时长，期间切走设置页 → 卸载后 setState（#4240）。换用现成的 `useBusyAction`（自带卸载守卫，§12.18 复用既有地基）。用例：卸载后断言 busy 态不落地。
