## Fixed

- **`--dockerfile` 的两条弯路各补一句可行动的提示**（ISSUE #2006）：
  - 它**只打 stdout、不写文件**，落盘是 `--write`（写出 `docker/ci-node.Dockerfile`）。
    照文档敲完 `--dockerfile` 的人会去 `ls docker` 得到「没有这个文件」，然后怀疑脚本坏了。
    提示放在正文开头的 `#` 注释里（`dockerfileHint()`）—— Dockerfile 自己的注释语法，
    `| docker build -f -` 当注释忽略它、`> docker/ci-node.Dockerfile` 让它成为文件头的一条
    说明。**刻意不走 stderr**：不重定向时它会和 `|` 那半个管道抢终端，`2>` 了它的人又
    什么都看不到。
  - 造镜像那条命令改成 `| docker build … -f -`：原来生成的 `-f <(…)` 是 **POSIX shell 的
    进程替换**，PowerShell / cmd 上会被当成一个叫 `<` 的文件，报
    `The system cannot find the file specified` —— 那条红读起来像「脚本没产出文件」，
    实际是这两句根本不是同一件事。管道喂 stdin 在两个 shell 里是同一个写法。

## Docs

- `docs/guides/ci-node-image.md` §2 的造镜像命令改成管道形态，并补一节「落盘用 `--write`
  / 别写 `-f <(...)`」；规范 §13.5.3.4.1.2 记下这两条形态与它们的理由。
