export function initializeDiscordBindingStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS discord_project_bindings (
      channel_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      bound_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS discord_project_bindings_project
      ON discord_project_bindings(project_id);
  `);
}

export function bindDiscordChannelToProject(db, {
  channelId, projectId, boundBy
}) {
  if (![channelId, projectId, boundBy].every(value =>
    typeof value === "string" && value.trim())) {
    throw new TypeError("Canal Discord, projet et auteur du lien sont requis.");
  }
  initializeDiscordBindingStore(db);
  const project = db.prepare("SELECT id FROM projects WHERE id=?").get(projectId);
  if (!project) throw new Error("Projet ICARE introuvable.");
  db.prepare(`INSERT INTO discord_project_bindings(channel_id,project_id,bound_by,created_at)
    VALUES(?,?,?,?)
    ON CONFLICT(channel_id) DO UPDATE SET
      project_id=excluded.project_id,bound_by=excluded.bound_by,created_at=excluded.created_at`)
    .run(channelId, projectId, boundBy, new Date().toISOString());
  return { channelId, projectId, boundBy };
}

export function unbindDiscordChannel(db, channelId) {
  initializeDiscordBindingStore(db);
  return db.prepare("DELETE FROM discord_project_bindings WHERE channel_id=?").run(channelId).changes === 1;
}

export function getDiscordBoundProject(db, {
  channelId, parentChannelId = null, defaultProjectId = null
}) {
  initializeDiscordBindingStore(db);
  const ids = [channelId, parentChannelId].filter(Boolean);
  for (const id of ids) {
    const row = db.prepare("SELECT project_id FROM discord_project_bindings WHERE channel_id=?").get(id);
    if (row) return row.project_id;
  }
  if (defaultProjectId && db.prepare("SELECT id FROM projects WHERE id=?").get(defaultProjectId)) {
    return defaultProjectId;
  }
  return null;
}
