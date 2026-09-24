import { Database } from "bun:sqlite";

const db = new Database(process.env.DB_PATH ?? "rebalancer.sqlite");
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS job_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    error TEXT
  )
`,
).run();

interface JobStatusRow {
  id: number;
  status: "completed" | "running";
  started_at: string;
  finished_at?: string;
  error?: string;
}

export function isJobRunning(): boolean {
  const row = db
    .prepare("SELECT status FROM job_status ORDER BY id DESC LIMIT 1")
    .get() as { status: string } | undefined;
  return row?.status === "running";
}

export function markJobStarted(): void {
  db.prepare(
    "INSERT INTO job_status (status, started_at) VALUES (?, datetime('now'))",
  ).run("running");
}

export function markJobCompleted(errorMessage?: string): void {
  if (errorMessage) {
    db.prepare(
      "UPDATE job_status SET status = 'completed', finished_at = datetime('now'), error = ? WHERE status = 'running'",
    ).run(errorMessage);
  } else {
    db.prepare(
      "UPDATE job_status SET status = 'completed', finished_at = datetime('now'), error = NULL WHERE status = 'running'",
    ).run();
  }
}

export function getLastJobStatus(): JobStatusRow | null {
  const row = db
    .prepare("SELECT * FROM job_status ORDER BY id DESC LIMIT 1")
    .get() as JobStatusRow | undefined;
  return row ?? null;
}

export function getJobHistory(limit: number = 10): JobStatusRow[] {
  return db
    .prepare("SELECT * FROM job_status ORDER BY id DESC LIMIT ?")
    .all(limit) as JobStatusRow[];
}
