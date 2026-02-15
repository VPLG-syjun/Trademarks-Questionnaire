import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(__dirname, '..', 'data', 'surveys.db');

// Ensure data directory exists
import fs from 'fs';
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS surveys (
    id TEXT PRIMARY KEY,
    customer_info TEXT NOT NULL,
    answers TEXT NOT NULL,
    total_price INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    admin_notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    reviewed_at DATETIME,
    document_generated_at DATETIME
  );

  CREATE INDEX IF NOT EXISTS idx_surveys_status ON surveys(status);
  CREATE INDEX IF NOT EXISTS idx_surveys_created_at ON surveys(created_at);
`);

export default db;
