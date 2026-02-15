import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = path.join(__dirname, '..', '..', 'data', 'surveys.db');

// Ensure data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

export function up() {
  console.log('Running migration: 001_create_templates');

  db.exec(`
    -- 템플릿 테이블
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      category TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_active INTEGER DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category);
    CREATE INDEX IF NOT EXISTS idx_templates_is_active ON templates(is_active);
    CREATE INDEX IF NOT EXISTS idx_templates_name ON templates(name);

    -- 템플릿 변수 테이블
    CREATE TABLE IF NOT EXISTS template_variables (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      variable_name TEXT NOT NULL,
      variable_key TEXT NOT NULL,
      question_ids TEXT,
      data_type TEXT DEFAULT 'text' CHECK(data_type IN ('text', 'date', 'number', 'currency')),
      is_required INTEGER DEFAULT 0,
      default_value TEXT,
      transformation_rule TEXT,
      FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_template_variables_template_id ON template_variables(template_id);
    CREATE INDEX IF NOT EXISTS idx_template_variables_variable_key ON template_variables(variable_key);

    -- 템플릿 선택 규칙 테이블
    CREATE TABLE IF NOT EXISTS template_rules (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      rule_type TEXT NOT NULL CHECK(rule_type IN ('question_answer', 'calculated', 'always')),
      question_id TEXT,
      condition_operator TEXT CHECK(condition_operator IN ('==', '!=', 'contains', 'not_contains', 'in', 'not_in', '>=', '<=', '>', '<')),
      condition_value TEXT,
      priority INTEGER DEFAULT 100,
      FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_template_rules_template_id ON template_rules(template_id);
    CREATE INDEX IF NOT EXISTS idx_template_rules_priority ON template_rules(priority);
    CREATE INDEX IF NOT EXISTS idx_template_rules_rule_type ON template_rules(rule_type);
  `);

  console.log('Migration 001_create_templates completed successfully');
}

export function down() {
  console.log('Rolling back migration: 001_create_templates');

  db.exec(`
    DROP TABLE IF EXISTS template_rules;
    DROP TABLE IF EXISTS template_variables;
    DROP TABLE IF EXISTS templates;
  `);

  console.log('Rollback 001_create_templates completed successfully');
}

// Run migration if executed directly
if (require.main === module) {
  const action = process.argv[2];

  if (action === 'down') {
    down();
  } else {
    up();
  }

  db.close();
}

export default { up, down };
