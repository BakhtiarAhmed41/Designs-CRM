-- Workflow completion tables. Column adds for existing DBs are in migrate.ts.

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key   VARCHAR(80)  NOT NULL,
  setting_value TEXT         NOT NULL,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO app_settings (setting_key, setting_value) VALUES
  ('turnaround.standard.label', 'Standard (12-24 hrs)'),
  ('turnaround.standard.hours', '24'),
  ('turnaround.urgent.label', 'Rush (4-8 hrs)'),
  ('turnaround.urgent.hours', '8');

CREATE TABLE IF NOT EXISTS quote_drafts (
  id           CHAR(36)     NOT NULL,
  user_id      CHAR(36)     NOT NULL,
  service_key  VARCHAR(40)  NOT NULL,
  payload      JSON         NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_quote_draft_user_svc (user_id, service_key),
  KEY idx_quote_draft_user (user_id),
  CONSTRAINT fk_quote_draft_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quote_intents (
  id           CHAR(36)     NOT NULL,
  claim_token  VARCHAR(80)  NOT NULL,
  service_key  VARCHAR(40)  NOT NULL,
  payload      JSON         NOT NULL,
  claimed_by   CHAR(36)     NULL,
  claimed_at   DATETIME     NULL,
  order_id     CHAR(36)     NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_quote_intent_token (claim_token),
  KEY idx_quote_intent_exp (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS format_requests (
  id               CHAR(36)     NOT NULL,
  customer_id      CHAR(36)     NULL,
  order_id         CHAR(36)     NOT NULL,
  delivery_file_id CHAR(36)     NULL,
  requested_format VARCHAR(60)  NOT NULL,
  note             TEXT         NULL,
  status           ENUM('PENDING','IN_PROGRESS','DONE','CANCELLED') NOT NULL DEFAULT 'PENDING',
  created_by_id    CHAR(36)     NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at      DATETIME     NULL,
  PRIMARY KEY (id),
  KEY idx_fmt_order (order_id),
  KEY idx_fmt_status (status),
  CONSTRAINT fk_fmt_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
