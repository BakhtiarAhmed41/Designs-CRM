-- Messages redesign: chat types, status, soft-delete/reply, team unread, staff attachments

ALTER TABLE conversations
  ADD COLUMN chat_type ENUM('GENERAL','ORDER','QUOTE') NOT NULL DEFAULT 'GENERAL' AFTER order_id,
  ADD COLUMN status ENUM('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN' AFTER chat_type;

-- Backfill chat_type from linked order (quotes live in orders table)
UPDATE conversations c
LEFT JOIN orders o ON o.id = c.order_id
SET c.chat_type = CASE
  WHEN c.order_id IS NULL THEN 'GENERAL'
  WHEN o.type = 'QUOTE_REQUEST' THEN 'QUOTE'
  ELSE 'ORDER'
END;

ALTER TABLE messages
  ADD COLUMN reply_to_message_id CHAR(36) NULL AFTER body,
  ADD COLUMN deleted_at DATETIME NULL AFTER reply_to_message_id;

ALTER TABLE staff_messages
  ADD COLUMN read_at DATETIME NULL AFTER body;

CREATE TABLE IF NOT EXISTS staff_group_reads (
  user_id      CHAR(36) NOT NULL,
  last_read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_sgr_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_message_attachments (
  id              CHAR(36)     NOT NULL,
  message_id      CHAR(36)     NOT NULL,
  channel         ENUM('DM','GROUP') NOT NULL,
  original_name   VARCHAR(255) NOT NULL,
  mime_type       VARCHAR(150) NULL,
  byte_size       INT          NULL,
  storage_key     VARCHAR(500) NOT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_staff_msg_att_key (storage_key),
  KEY idx_staff_msg_att_message (message_id, channel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
