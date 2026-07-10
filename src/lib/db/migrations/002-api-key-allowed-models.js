const migration = {
  version: 2,
  name: "api-key-allowed-models",
  up(db) {
    const columns = db.all(`PRAGMA table_info(apiKeys)`);
    if (!columns.some((column) => column.name === "allowedModels")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN allowedModels TEXT`);
    }
  },
};

export default migration;
