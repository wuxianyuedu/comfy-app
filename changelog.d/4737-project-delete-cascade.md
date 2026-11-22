## Fixed

- **项目删除级联清理，不再留孤儿行与永不回收的磁盘产物**（ISSUE #4737）：
  `project.delete` 此前只删 project 一行——production（全部镜头 / 角色 / 评审）、
  工坊会话、成片、任务行与 `generated/projects/<projectId>/**` 磁盘产物全部留存，
  磁盘单调增长且没有任何清理路径。
  - 归属语义（唯一出处 `src/server/project/delete-project-cascade.ts`，并写入
    产品规格 FR-CV-01）：**删项目 = 删掉它在库与盘上的全部痕迹**——任务（含
    产物图与日志）、成片（含镜头与 `films/<id>.mp4`）、会话、production 与
    磁盘产物目录一并清理。
  - 顺序：先库（单事务，id+userId 归属闸在先，他人 / 不存在一行不动、仍回 ok），
    后盘（尽力而为，失败只 warn——盘上孤儿可再清，库行没了才不可恢复）。
  - 删除确认弹窗明示级联范围（知情删除）。
