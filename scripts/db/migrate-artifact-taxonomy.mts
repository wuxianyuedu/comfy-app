/**
 * 一次性迁移：把历史任务的产物目录从平铺 `<taskId>` / `projects/<pid>/<tid>`
 * 搬到三级分类 `<mediaType>/<modelName>/<modeCode>/<taskId>`，并把库里的
 * `TaskImage.localPath` 与 `Task.resultImages` 同步改写。
 *
 * 用法（必须用 tsx，脚本直接吃 TS 地基，避免再抄一份分类口径）：
 *   pnpm exec tsx scripts/db/migrate-artifact-taxonomy.mts            # 只读盘点
 *   pnpm exec tsx scripts/db/migrate-artifact-taxonomy.mts --apply    # 真迁移
 *   pnpm exec tsx scripts/db/migrate-artifact-taxonomy.mts --rollback # 按清单回滚
 *
 * --apply 会先把 db.sqlite 与清单一起备份到 .tmp/migrations/<时间戳>/，
 * 失败时可用 --rollback 把目录与库一起还原。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { taxonomyFrom } from "../../src/lib/media/artifact-taxonomy";
import {
  artifactDiskPath,
  generatedRoot,
  taskOutputDir,
  taskOutputUrl,
} from "../../src/lib/media/output-paths";

const apply = process.argv.includes("--apply");
const rollback = process.argv.includes("--rollback");
const root = process.cwd();
const dbFile = path.join(root, "db.sqlite");
const artifacts = generatedRoot(root);

type Job = {
  newDir: string;
  oldDir: string;
  oldPaths: Array<{ before: unknown; id: string; table: "taskImage" | "task" }>;
  taskId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** sqlite 的 .all() 返回宽泛的 Record，逐字段判形状后才用，不做窄类型断言。 */
function imageRows(rows: unknown): Array<{ id: string; localPath: string }> {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.flatMap((row) => {
    if (!isRecord(row)) {
      return [];
    }
    const id = asString(row.id);
    const localPath = asString(row.localPath);
    return id !== null && localPath !== null ? [{ id, localPath }] : [];
  });
}

function tagName(row: unknown): string | null {
  return isRecord(row) ? asString(row.name) : null;
}

function templateCodes(row: unknown): { defaultMode: string | null; taskType: string | null } {
  if (!isRecord(row)) {
    return { defaultMode: null, taskType: null };
  }
  return { defaultMode: asString(row.defaultMode), taskType: asString(row.taskType) };
}

/** 每个任务的新旧 URL 前缀（写库时要逐条替换）。 */
const jobMeta = new Map<string, { newBase: string; oldBase: string }>();

/** 读一行 JSON 里的 workflow 模板 id。 */
function templateIdOf(params: unknown): string | null {
  if (typeof params !== "string" || params === "") {
    return null;
  }
  try {
    const value: unknown = JSON.parse(params);
    if (isRecord(value)) {
      const id = value.workflow;
      return typeof id === "string" && id !== "" ? id : null;
    }
  } catch {
    /* 坏 JSON 按没有模板处理 */
  }
  return null;
}

type TaskRow = {
  id: string;
  localPath: string;
  mediaType: string;
  params: string | null;
  type: string;
  workflowName: string;
};

/** sqlite 的宽行收窄成任务行，逐字段判形状。 */
function taskRows(rows: unknown): Array<TaskRow> {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.flatMap((row) => {
    if (!isRecord(row)) {
      return [];
    }
    const id = asString(row.id);
    const localPath = asString(row.localPath);
    const mediaType = asString(row.mediaType);
    const type = asString(row.type);
    const workflowName = asString(row.workflowName);
    const params = asString(row.params);
    return id !== null &&
      localPath !== null &&
      mediaType !== null &&
      type !== null &&
      workflowName !== null
      ? [{ id, localPath, mediaType, params, type, workflowName }]
      : [];
  });
}

function buildJobs(db: DatabaseSync): { jobs: Array<Job>; skipped: number } {
  const tasks = taskRows(
    db
      .prepare(
        `select t.id, t.type, t.workflowName, t.params,
                ti.localPath, ti.mediaType
           from task t join taskImage ti on ti.taskId = t.id
          order by t.id, ti.sortIndex`,
      )
      .all(),
  );
  const tagStmt = db.prepare(
    `select tag.name as name
       from workflowModelTag_workflowTemplate link
       join workflowModelTag tag on tag.id = link.workflowModelTag
      where link.workflowTemplate = ? limit 1`,
  );
  const templateStmt = db.prepare(
    `select defaultMode, taskType from workflowTemplate where id = ? limit 1`,
  );

  const byTask = new Map<string, (typeof tasks)[number][]>();
  for (const row of tasks) {
    const list = byTask.get(row.id) ?? [];
    list.push(row);
    byTask.set(row.id, list);
  }

  const jobs: Array<Job> = [];
  let skipped = 0;
  for (const [taskId, rows] of byTask) {
    const first = rows[0];
    if (first === undefined) {
      skipped++;
      continue;
    }
    const oldFile = artifactDiskPath(first.localPath, artifacts);
    if (oldFile === null || !fs.existsSync(oldFile)) {
      skipped++;
      continue;
    }
    const oldDir = path.dirname(oldFile);
    const templateId = templateIdOf(first.params);
    const tagNameValue =
      templateId === null ? null : tagName(tagStmt.get(templateId));
    const tpl =
      templateId === null
        ? { defaultMode: null, taskType: null }
        : templateCodes(templateStmt.get(templateId));
    const taxonomy = taxonomyFrom({
      mediaType: first.mediaType,
      modelName: tagNameValue ?? first.workflowName,
      modeCode: tpl.defaultMode ?? tpl.taskType ?? first.type,
    });
    const newDir = taskOutputDir(taxonomy, taskId, artifacts);
    const newBase = taskOutputUrl(taxonomy, taskId);
    if (newDir === null || newDir === oldDir) {
      skipped++;
      continue;
    }
    const oldBase = first.localPath.slice(0, first.localPath.lastIndexOf("/"));
    const imageIds = imageRows(
      db.prepare("select id, localPath from taskImage where taskId = ?").all(taskId),
    );
    const oldPaths: Job["oldPaths"] = imageIds.map((image) => ({
      before: image.localPath,
      id: image.id,
      table: "taskImage",
    }));
    const taskRow = db.prepare("select resultImages from task where id = ?").get(taskId);
    const resultImages = isRecord(taskRow) ? asString(taskRow.resultImages) : null;
    if (resultImages !== null) {
      oldPaths.push({ before: resultImages, id: taskId, table: "task" });
    }
    jobMeta.set(taskId, { newBase, oldBase });
    jobs.push({ taskId, oldDir, newDir, oldPaths });
  }
  return { jobs, skipped };
}

type Move = { newDir: string; oldDir: string; taskId: string };

/** 回滚清单：逐字段判形状，不用窄断言把 any 变成可信结构。 */
function parseManifest(raw: string): { backup: string; moves: Array<Move> } | null {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || typeof value.backup !== "string" || !Array.isArray(value.moves)) {
    return null;
  }
  const moves = value.moves.flatMap((row) => {
    if (!isRecord(row)) {
      return [];
    }
    const newDir = asString(row.newDir);
    const oldDir = asString(row.oldDir);
    const taskId = asString(row.taskId);
    return newDir !== null && oldDir !== null && taskId !== null ? [{ newDir, oldDir, taskId }] : [];
  });
  return { backup: value.backup, moves };
}

function stamp(): string {
  return new Date().toISOString().replaceAll(/[:.]/g, "-");
}

if (rollback) {
  const dir = path.join(root, ".tmp", "migrations", fs.readdirSync(path.join(root, ".tmp", "migrations")).sort().at(-1)!);
  const manifest = parseManifest(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  if (manifest === null) {
    throw new Error("回滚清单形状不对，已停止（库未改动）");
  }
  for (const m of [...manifest.moves].reverse()) {
    if (fs.existsSync(m.newDir)) {
      fs.mkdirSync(path.dirname(m.oldDir), { recursive: true });
      fs.renameSync(m.newDir, m.oldDir);
    }
  }
  fs.copyFileSync(path.join(dir, manifest.backup), dbFile);
  console.log(`已按 ${dir} 回滚目录与数据库。`);
  process.exit(0);
}

const db = new DatabaseSync(dbFile, { readOnly: !apply });
const { jobs, skipped } = buildJobs(db);
db.close();
console.log(`待迁移任务: ${jobs.length} | 跳过（无产物 / 已在目标）: ${skipped}`);
for (const j of jobs.slice(0, 5)) {
  console.log(`  ${j.taskId}\n    ${path.relative(artifacts, j.oldDir)}\n -> ${path.relative(artifacts, j.newDir)}`);
}
const dist = new Map<string, number>();
for (const j of jobs) {
  const key = path.relative(artifacts, j.newDir).split(path.sep).slice(0, 3).join(" / ");
  dist.set(key, (dist.get(key) ?? 0) + 1);
}
console.log("分类分布：");
for (const [key, n] of [...dist].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n}  ${key}`);
}
if (!apply) {
  console.log("dry-run 完毕（未写盘）。加 --apply 执行。");
  process.exit(0);
}

const dir = path.join(root, ".tmp", "migrations", stamp());
fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(dbFile, path.join(dir, "db.sqlite"));

const moves: Array<Move> = [];
const writeDb = new DatabaseSync(dbFile);
writeDb.exec("begin immediate");
try {
  const updateImage = writeDb.prepare("update taskImage set localPath = ? where id = ?");
  const updateTask = writeDb.prepare("update task set resultImages = ? where id = ?");
  for (const job of jobs) {
    fs.mkdirSync(path.dirname(job.newDir), { recursive: true });
    if (fs.existsSync(job.oldDir)) {
      fs.renameSync(job.oldDir, job.newDir);
      moves.push({ taskId: job.taskId, oldDir: job.oldDir, newDir: job.newDir });
    }
    const meta = jobMeta.get(job.taskId)!;
    for (const entry of job.oldPaths) {
      if (entry.table === "taskImage") {
        const after = String(entry.before).replace(meta.oldBase, meta.newBase);
        updateImage.run(after, entry.id);
      } else {
        const after = String(entry.before).replaceAll(meta.oldBase, meta.newBase);
        updateTask.run(after, entry.id);
      }
    }
  }
  writeDb.exec("commit");
} catch (error) {
  writeDb.exec("rollback");
  throw error;
} finally {
  writeDb.close();
}
fs.writeFileSync(
  path.join(dir, "manifest.json"),
  JSON.stringify({ backup: "db.sqlite", moves }, null, 2),
);
console.log(`已迁移 ${moves.length} 个任务目录；备份与清单在 ${dir}`);
