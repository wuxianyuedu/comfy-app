## Fixed

- 应用日志面板的「应用服务」一路看不到服务启动日志（dev.mjs 的端口行、命令回显、Next 横幅、`✓ Ready in …`）：输出转录的安装在 instrumentation `register()` 里，dev 下还是懒编译（`✓ Ready` 之后首个请求才触发），启动段永远写在安装之前、转录里没有。现在安装时会先把 stdout 重定向文件（`log/current/nextjs/nextjs-stdout-*.log`）**截至安装时刻**的快照回填进转录（封顶 1MB、按行对齐；快照严格先于钩子安装，与实时转录不重叠；无重定向文件的 standalone / 裸 dev 回退空串、行为不变），面板从进程启动的第一行起可见。（#4681）
