CREATE TABLE issue_intake (
  issue_id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT,
  title TEXT NOT NULL,
  description TEXT,
  issue_url TEXT,
  team_id TEXT NOT NULL,
  project_id TEXT,
  priority INTEGER,
  state_id TEXT,
  created_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  delivery_id TEXT
);
