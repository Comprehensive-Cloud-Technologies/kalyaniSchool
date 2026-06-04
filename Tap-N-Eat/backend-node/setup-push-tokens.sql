CREATE TABLE IF NOT EXISTS parent_push_tokens (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  parent_email VARCHAR(191) NOT NULL,
  push_token   VARCHAR(255) NOT NULL,
  is_active    TINYINT(1)  NOT NULL DEFAULT 1,
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_parent_token (parent_email, push_token),
  INDEX idx_parent_email (parent_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SELECT 'parent_push_tokens table ready' AS status;
SHOW TABLES LIKE 'parent_push_tokens';
