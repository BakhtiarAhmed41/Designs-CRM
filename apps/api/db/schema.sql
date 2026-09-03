-- Designs-CRM full schema (MySQL 8 / MariaDB compatible).
-- Raw SQL, no ORM. Application generates CHAR(36) UUID primary keys.
-- Safe to run repeatedly (CREATE TABLE IF NOT EXISTS).

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------------
-- Users & auth
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            CHAR(36)     NOT NULL,
  email         VARCHAR(255) NOT NULL,
  pending_email VARCHAR(255) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('SUPER_ADMIN','ADMIN','SUPPORT','DESIGNER','CLIENT') NOT NULL DEFAULT 'CLIENT',
  login_status  ENUM('PENDING','ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
  custom_role_id CHAR(36)    NULL,
  first_name    VARCHAR(120) NULL,
  last_name     VARCHAR(120) NULL,
  phone         VARCHAR(60)  NULL,
  initials      VARCHAR(8)   NULL,
  presence      ENUM('ON','AWAY','OFF') NOT NULL DEFAULT 'OFF',
  skills        JSON         NULL,
  permissions   JSON         NULL,
  email_verified_at DATETIME NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role (role),
  KEY idx_users_login_status (login_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS custom_roles (
  id          CHAR(36)     NOT NULL,
  name        VARCHAR(120) NOT NULL,
  description VARCHAR(500) NULL,
  base_role   ENUM('ADMIN','SUPPORT','DESIGNER') NOT NULL DEFAULT 'SUPPORT',
  permissions JSON         NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_custom_roles_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         CHAR(36)     NOT NULL,
  user_id    CHAR(36)     NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME     NOT NULL,
  used_at    DATETIME     NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_prt_user (user_id),
  KEY idx_prt_expires (expires_at),
  CONSTRAINT fk_prt_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id             CHAR(36)     NOT NULL,
  user_id        CHAR(36)     NOT NULL,
  token_hash     VARCHAR(255) NOT NULL,
  expires_at     DATETIME     NOT NULL,
  revoked_at     DATETIME     NULL,
  replaced_by_id CHAR(36)     NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rt_user (user_id),
  KEY idx_rt_expires (expires_at),
  CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Customers (a customer may or may not have a login user; supports guests)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id                CHAR(36)     NOT NULL,
  user_id           CHAR(36)     NULL,
  name              VARCHAR(200) NOT NULL,
  email             VARCHAR(255) NULL,
  phone             VARCHAR(60)  NULL,
  account_type      ENUM('PAY_PER_ORDER','NET_MONTHLY') NOT NULL DEFAULT 'PAY_PER_ORDER',
  net_terms         ENUM('NET_15','NET_30') NULL,
  source            ENUM('PORTAL','ETSY','GUEST','TEXT') NOT NULL DEFAULT 'PORTAL',
  store_credit_cents INT         NOT NULL DEFAULT 0,
  preferences       JSON         NULL,
  since_date        DATE         NULL,
  merged_into_id    CHAR(36)     NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_customers_user (user_id),
  KEY idx_customers_merged (merged_into_id),
  CONSTRAINT fk_customers_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id                   CHAR(36) NOT NULL,
  human_ref            VARCHAR(40) NULL,
  customer_id          CHAR(36) NULL,
  client_user_id       CHAR(36) NULL,
  type                 ENUM('ORDER','QUOTE_REQUEST') NOT NULL DEFAULT 'ORDER',
  service_type         ENUM('EMBROIDERY','SVG','VECTOR','CNC_LASER') NULL,
  main_category        VARCHAR(120) NULL,
  sub_category         VARCHAR(120) NULL,
  name                 VARCHAR(255) NULL,
  instructions         TEXT NULL,
  size                 VARCHAR(120) NULL,
  turnaround_key       VARCHAR(40) NULL,
  turnaround_label     VARCHAR(120) NULL,
  turnaround_hours     INT NULL,
  preferences          JSON NULL,
  status               ENUM(
                         'CREATED','WAITING_FOR_QUOTATION','QUOTATION_PROVIDED',
                         'CLIENT_REJECTED_QUOTATION','WAITING_FOR_ADMIN_QUOTATION_APPROVAL',
                         'PENDING_PAYMENT','IN_PROGRESS','READY_TO_SEND','REVISION_REQUESTED',
                         'COMPLETED','CLOSED','REJECTED','CANCELLED','REFUNDED'
                       ) NOT NULL DEFAULT 'WAITING_FOR_QUOTATION',
  price_cents          INT NULL,
  currency             VARCHAR(3) NOT NULL DEFAULT 'USD',
  channel              VARCHAR(40) NULL,
  created_by_role      ENUM('SUPER_ADMIN','ADMIN','SUPPORT','DESIGNER','CLIENT') NULL,
  created_by_id        CHAR(36) NULL,
  assigned_designer_id CHAR(36) NULL,
  parent_order_id      CHAR(36) NULL,
  due_date             DATE NULL,
  internal_notes       TEXT NULL,
  rejection_reason     TEXT NULL,
  approved_at          DATETIME NULL,
  rejected_at          DATETIME NULL,
  completed_at         DATETIME NULL,
  closed_at            DATETIME NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_orders_customer (customer_id),
  KEY idx_orders_client (client_user_id),
  KEY idx_orders_status (status),
  KEY idx_orders_type (type),
  KEY idx_orders_designer (assigned_designer_id),
  KEY idx_orders_parent (parent_order_id),
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL,
  CONSTRAINT fk_orders_client FOREIGN KEY (client_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_orders_designer FOREIGN KEY (assigned_designer_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_orders_parent FOREIGN KEY (parent_order_id) REFERENCES orders (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_designs (
  id                CHAR(36) NOT NULL,
  order_id          CHAR(36) NOT NULL,
  name              VARCHAR(255) NOT NULL,
  placement         VARCHAR(120) NULL,
  size              VARCHAR(120) NULL,
  status            ENUM('WAITING','IN_PROGRESS','DONE','DELIVERED') NOT NULL DEFAULT 'WAITING',
  price_cents       INT NULL,
  requested_formats JSON NULL,
  sort_order        INT NOT NULL DEFAULT 0,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_designs_order (order_id),
  CONSTRAINT fk_designs_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_attachments (
  id               CHAR(36) NOT NULL,
  order_id         CHAR(36) NOT NULL,
  uploaded_by_role ENUM('SUPER_ADMIN','ADMIN','SUPPORT','DESIGNER','CLIENT') NULL,
  uploaded_by_id   CHAR(36) NULL,
  original_name    VARCHAR(255) NOT NULL,
  mime_type        VARCHAR(150) NULL,
  byte_size        INT NULL,
  storage_key      VARCHAR(500) NOT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_att_key (storage_key),
  KEY idx_att_order (order_id),
  CONSTRAINT fk_att_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Quotations (versioned) + quote-builder line items + per-size prices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quotations (
  id              CHAR(36) NOT NULL,
  order_id        CHAR(36) NOT NULL,
  version         INT NOT NULL,
  status          ENUM('NEEDS_PRICE','PROPOSED','SENT','COUNTERED','APPROVED','REJECTED') NOT NULL DEFAULT 'PROPOSED',
  created_by_role ENUM('SUPER_ADMIN','ADMIN','SUPPORT','DESIGNER','CLIENT') NOT NULL,
  created_by_id   CHAR(36) NULL,
  amount_cents    INT NULL,
  currency        VARCHAR(3) NOT NULL DEFAULT 'USD',
  comment         TEXT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_quote_order_version (order_id, version),
  KEY idx_quote_order (order_id),
  KEY idx_quote_status (status),
  CONSTRAINT fk_quote_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quotation_lines (
  id              CHAR(36) NOT NULL,
  quotation_id    CHAR(36) NOT NULL,
  name            VARCHAR(255) NOT NULL,
  note            TEXT NULL,
  attachment_id   CHAR(36) NULL,
  price_cents     INT NULL,
  sort_order      INT NOT NULL DEFAULT 0,
  client_decision ENUM('PENDING','KEPT','DROPPED') NOT NULL DEFAULT 'PENDING',
  PRIMARY KEY (id),
  KEY idx_qline_quote (quotation_id),
  CONSTRAINT fk_qline_quote FOREIGN KEY (quotation_id) REFERENCES quotations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quotation_line_sizes (
  id          CHAR(36) NOT NULL,
  line_id     CHAR(36) NOT NULL,
  label       VARCHAR(120) NOT NULL,
  price_cents INT NOT NULL DEFAULT 0,
  sort_order  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_qsize_line (line_id),
  CONSTRAINT fk_qsize_line FOREIGN KEY (line_id) REFERENCES quotation_lines (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Deliveries (versioned) + files
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deliveries (
  id                  CHAR(36) NOT NULL,
  order_id            CHAR(36) NOT NULL,
  version             INT NOT NULL,
  delivered_via       ENUM('PORTAL','EMAIL') NOT NULL DEFAULT 'PORTAL',
  created_by_admin_id CHAR(36) NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at         DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_delivery_order_version (order_id, version),
  KEY idx_delivery_order (order_id),
  CONSTRAINT fk_delivery_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS delivery_files (
  id            CHAR(36) NOT NULL,
  delivery_id   CHAR(36) NOT NULL,
  design_id     CHAR(36) NULL,
  format_label  VARCHAR(60) NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type     VARCHAR(150) NULL,
  byte_size     INT NULL,
  storage_key   VARCHAR(500) NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dfile_key (storage_key),
  KEY idx_dfile_delivery (delivery_id),
  CONSTRAINT fk_dfile_delivery FOREIGN KEY (delivery_id) REFERENCES deliveries (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Edits & revisions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edit_requests (
  id                   CHAR(36) NOT NULL,
  order_id             CHAR(36) NOT NULL,
  design_id            CHAR(36) NULL,
  design_ids           JSON NULL,
  revision_order_id    CHAR(36) NULL,
  note                 TEXT NOT NULL,
  kind                 ENUM('FREE','PAID') NOT NULL DEFAULT 'FREE',
  price_cents          INT NULL,
  status               ENUM('PENDING','DONE') NOT NULL DEFAULT 'PENDING',
  assigned_designer_id CHAR(36) NULL,
  requested_by_id      CHAR(36) NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at          DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_edit_order (order_id),
  KEY idx_edit_status (status),
  CONSTRAINT fk_edit_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Billing: invoices, payments, store credit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id                        CHAR(36) NOT NULL,
  customer_id               CHAR(36) NOT NULL,
  order_id                  CHAR(36) NULL,
  kind                      ENUM('PER_ORDER','MONTHLY','ADD_ON') NOT NULL DEFAULT 'PER_ORDER',
  amount_cents              INT NOT NULL,
  amount_paid_cents         INT NOT NULL DEFAULT 0,
  currency                  VARCHAR(3) NOT NULL DEFAULT 'USD',
  covers_text               VARCHAR(500) NULL,
  status                    ENUM('AWAITING','PARTIAL','PAID','CANCELLED') NOT NULL DEFAULT 'AWAITING',
  period_month              CHAR(7) NULL,
  store_credit_applied_cents INT NOT NULL DEFAULT 0,
  issued_at                 DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_at                    DATETIME NULL,
  paid_at                   DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_invoice_customer (customer_id),
  KEY idx_invoice_status (status),
  CONSTRAINT fk_invoice_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_lines (
  id           CHAR(36) NOT NULL,
  invoice_id   CHAR(36) NOT NULL,
  order_id     CHAR(36) NULL,
  description  VARCHAR(255) NOT NULL,
  amount_cents INT NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_inv_line_invoice (invoice_id),
  UNIQUE KEY uq_inv_line_order (order_id),
  CONSTRAINT fk_inv_line_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id             CHAR(36) NOT NULL,
  invoice_id     CHAR(36) NULL,
  order_id       CHAR(36) NULL,
  customer_id    CHAR(36) NULL,
  amount_cents   INT NOT NULL,
  currency       VARCHAR(3) NOT NULL DEFAULT 'USD',
  method         ENUM('CARD','LINK','STORE_CREDIT') NOT NULL DEFAULT 'CARD',
  type           ENUM('CHARGE','REFUND') NOT NULL DEFAULT 'CHARGE',
  refund_to      ENUM('CARD','STORE_CREDIT') NULL,
  pay_link_token VARCHAR(80) NULL,
  status         ENUM('PENDING','PAID','FAILED','REFUNDED') NOT NULL DEFAULT 'PENDING',
  reason         VARCHAR(500) NULL,
  stripe_checkout_session_id VARCHAR(255) NULL,
  stripe_payment_intent_id VARCHAR(255) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at        DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pay_link (pay_link_token),
  UNIQUE KEY uq_stripe_session (stripe_checkout_session_id),
  KEY idx_pay_invoice (invoice_id),
  KEY idx_pay_order (order_id),
  KEY idx_pay_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS store_credit_entries (
  id          CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  delta_cents INT NOT NULL,
  reason      VARCHAR(500) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_credit_customer (customer_id),
  CONSTRAINT fk_credit_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id             CHAR(36) NOT NULL,
  customer_id    CHAR(36) NULL,
  order_id       CHAR(36) NULL,
  chat_type      ENUM('GENERAL','ORDER','QUOTE') NOT NULL DEFAULT 'GENERAL',
  status         ENUM('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
  subject        VARCHAR(255) NULL,
  label          ENUM('EDIT','PAYMENT','CUSTOM','IMPORTANT') NULL,
  source         ENUM('PORTAL','SITE_CHAT') NOT NULL DEFAULT 'PORTAL',
  archived       TINYINT(1) NOT NULL DEFAULT 0,
  hidden_from_client TINYINT(1) NOT NULL DEFAULT 0,
  private_notes  TEXT NULL,
  last_message_at DATETIME NULL,
  unread_admin   INT NOT NULL DEFAULT 0,
  unread_client  INT NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_convo_customer (customer_id),
  KEY idx_convo_order (order_id),
  KEY idx_convo_chat_type (chat_type),
  KEY idx_convo_status (status),
  CONSTRAINT fk_convo_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id                  CHAR(36) NOT NULL,
  conversation_id     CHAR(36) NOT NULL,
  sender_user_id      CHAR(36) NULL,
  direction           ENUM('INBOUND','OUTBOUND') NOT NULL,
  body                TEXT NOT NULL,
  reply_to_message_id CHAR(36) NULL,
  deleted_at          DATETIME NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_msg_convo (conversation_id),
  CONSTRAINT fk_msg_convo FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS message_templates (
  id         CHAR(36) NOT NULL,
  title      VARCHAR(150) NOT NULL,
  body       TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Notifications & activity log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         CHAR(36) NOT NULL,
  user_id    CHAR(36) NOT NULL,
  title      VARCHAR(255) NOT NULL,
  body       TEXT NULL,
  link       VARCHAR(500) NULL,
  read_at    DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notif_user_created (user_id, created_at),
  KEY idx_notif_user_read (user_id, read_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_logs (
  id         CHAR(36) NOT NULL,
  order_id   CHAR(36) NULL,
  actor_id   CHAR(36) NULL,
  event      VARCHAR(120) NOT NULL,
  meta       JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_activity_order (order_id),
  CONSTRAINT fk_activity_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Staff (team) direct messages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_messages (
  id           CHAR(36) NOT NULL,
  from_user_id CHAR(36) NOT NULL,
  to_user_id   CHAR(36) NOT NULL,
  body         TEXT NOT NULL,
  read_at      DATETIME NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_staff_msg_pair (from_user_id, to_user_id, created_at),
  KEY idx_staff_msg_to (to_user_id, created_at),
  KEY idx_staff_msg_unread (to_user_id, read_at),
  CONSTRAINT fk_staff_msg_from FOREIGN KEY (from_user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_staff_msg_to FOREIGN KEY (to_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_group_messages (
  id             CHAR(36) NOT NULL,
  sender_user_id CHAR(36) NOT NULL,
  body           TEXT     NOT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sgm_created (created_at),
  CONSTRAINT fk_sgm_sender FOREIGN KEY (sender_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_group_reads (
  user_id      CHAR(36) NOT NULL,
  last_read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_sgr_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS message_attachments (
  id              CHAR(36)     NOT NULL,
  message_id      CHAR(36)     NOT NULL,
  original_name   VARCHAR(255) NOT NULL,
  mime_type       VARCHAR(150) NULL,
  byte_size       INT          NULL,
  storage_key     VARCHAR(500) NOT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_msg_att_key (storage_key),
  KEY idx_msg_att_message (message_id),
  CONSTRAINT fk_msg_att_message FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE
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
  invoice_id       CHAR(36)     NULL,
  price_cents      INT          NULL,
  status           ENUM('PENDING','IN_PROGRESS','DONE','CANCELLED') NOT NULL DEFAULT 'PENDING',
  created_by_id    CHAR(36)     NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at      DATETIME     NULL,
  PRIMARY KEY (id),
  KEY idx_fmt_order (order_id),
  KEY idx_fmt_status (status),
  CONSTRAINT fk_fmt_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
