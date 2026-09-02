BEGIN;

CREATE TABLE IF NOT EXISTS focusboard_tasks (
  row_key BIGSERIAL PRIMARY KEY,
  id TEXT NOT NULL,
  workspace_code TEXT NOT NULL,
  user_id TEXT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  priority TEXT NOT NULL,
  due_date DATE,
  notes TEXT,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

ALTER TABLE focusboard_tasks
  ADD COLUMN IF NOT EXISTS user_id TEXT;

ALTER TABLE focusboard_tasks
  ADD COLUMN IF NOT EXISTS row_key BIGSERIAL;

ALTER TABLE focusboard_tasks
  DROP CONSTRAINT IF EXISTS focusboard_tasks_pkey;

ALTER TABLE focusboard_tasks
  ADD CONSTRAINT focusboard_tasks_pkey PRIMARY KEY (row_key);

CREATE INDEX IF NOT EXISTS focusboard_tasks_user_id_idx
  ON focusboard_tasks (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS focusboard_tasks_user_task_idx
  ON focusboard_tasks (user_id, id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS focusboard_tasks_legacy_workspace_task_idx
  ON focusboard_tasks (workspace_code, id)
  WHERE user_id IS NULL;

COMMIT;