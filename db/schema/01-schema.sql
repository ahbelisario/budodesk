-- =====================================================================
-- BudoDesk — Esquema v2 (multi-dojo)
-- MySQL 8.0+ / utf8mb4
--
-- Principios:
--   1. Un solo despliegue, muchos dojos. Toda tabla de negocio lleva dojo_id.
--   2. Aislamiento reforzado en la BD: las relaciones entre tablas de un dojo
--      usan llaves foráneas compuestas (dojo_id, id), así es imposible ligar
--      una reserva del dojo A a una clase del dojo B aunque el backend falle.
--   3. Las personas (users) son globales: un email, una contraseña.
--      La pertenencia y los roles viven por dojo en dojo_members.
--   4. Lo que se debe (charges) está separado de lo que se pagó (payments).
--      payment_allocations liga ambos (permite pagos parciales y PayPal).
--   5. Nada de borrar historia: estados + fechas en lugar de DELETE.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS `budodesk`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE `budodesk`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- =====================================================================
-- 1. PLATAFORMA: dojos
-- =====================================================================

CREATE TABLE `dojos` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug`            VARCHAR(60)  NOT NULL COMMENT 'subdominio: seikoukan.budodesk.com',
  `name`            VARCHAR(255) NOT NULL,
  `short_name`      VARCHAR(50)  NULL,
  `legal_name`      VARCHAR(255) NULL,
  `tax_id`          VARCHAR(50)  NULL,
  `logo_url`        VARCHAR(500) NULL,
  `phone`           VARCHAR(50)  NULL,
  `email`           VARCHAR(150) NULL,
  `website`         VARCHAR(255) NULL,
  `address_line1`   VARCHAR(255) NULL,
  `address_line2`   VARCHAR(255) NULL,
  `city`            VARCHAR(100) NULL,
  `state`           VARCHAR(100) NULL,
  `postal_code`     VARCHAR(20)  NULL,
  `country_code`    CHAR(2)      NOT NULL DEFAULT 'MX',
  `facebook_url`    VARCHAR(255) NULL,
  `instagram_url`   VARCHAR(255) NULL,
  `tiktok_url`      VARCHAR(255) NULL,
  `currency`        CHAR(3)      NOT NULL DEFAULT 'MXN',
  `timezone`        VARCHAR(50)  NOT NULL DEFAULT 'America/Mexico_City',
  `language`        VARCHAR(5)   NOT NULL DEFAULT 'es',
  -- Tema visual (ThemeProvider)
  `color_primary`   CHAR(7)      NULL DEFAULT '#B91C1C',
  `color_secondary` CHAR(7)      NULL DEFAULT '#111827',
  `color_accent`    CHAR(7)      NULL DEFAULT '#F59E0B',
  -- Reglas de operación
  `booking_cancel_hours`   SMALLINT UNSIGNED NOT NULL DEFAULT 2  COMMENT 'horas antes para cancelar sin penalización',
  `booking_window_days`    SMALLINT UNSIGNED NOT NULL DEFAULT 14 COMMENT 'con cuántos días de anticipación se puede reservar',
  `require_membership_to_book` TINYINT(1) NOT NULL DEFAULT 1,
  `self_registration`      ENUM('closed','approval','open') NOT NULL DEFAULT 'approval',
  `privacy_policy`  MEDIUMTEXT NULL,
  `privacy_version` VARCHAR(10) NULL,
  `terms_conditions` MEDIUMTEXT NULL,
  -- Suscripción del dojo a BudoDesk
  `plan`            ENUM('trial','basic','pro') NOT NULL DEFAULT 'trial',
  `status`          ENUM('trial','active','suspended','cancelled') NOT NULL DEFAULT 'trial',
  `trial_ends_at`   DATETIME NULL,
  `created_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dojos_slug` (`slug`)
) ENGINE=InnoDB;

CREATE TABLE `dojo_locations` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dojo_id`    INT UNSIGNED NOT NULL,
  `name`       VARCHAR(120) NOT NULL COMMENT 'Sede, tatami 1, gimnasio escuela X…',
  `address`    VARCHAR(255) NULL,
  `active`     TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_loc_dojo_id` (`dojo_id`,`id`),
  CONSTRAINT `fk_loc_dojo` FOREIGN KEY (`dojo_id`) REFERENCES `dojos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Credenciales de cobro por dojo. Los secretos se guardan CIFRADOS por el
-- backend (AES-256-GCM con una llave en variable de entorno), nunca en claro.
CREATE TABLE `dojo_payment_settings` (
  `dojo_id`               INT UNSIGNED NOT NULL,
  `paypal_enabled`        TINYINT(1) NOT NULL DEFAULT 0,
  `paypal_mode`           ENUM('sandbox','live') NOT NULL DEFAULT 'sandbox',
  `paypal_client_id`      VARCHAR(255) NULL,
  `paypal_secret_enc`     VARBINARY(512) NULL,
  `paypal_webhook_id`     VARCHAR(100) NULL,
  `accepts_cash`          TINYINT(1) NOT NULL DEFAULT 1,
  `accepts_transfer`      TINYINT(1) NOT NULL DEFAULT 1,
  `transfer_instructions` TEXT NULL COMMENT 'CLABE/banco que verá el alumno',
  `late_fee_amount`       DECIMAL(10,2) NULL,
  `late_fee_grace_days`   SMALLINT UNSIGNED NULL,
  `updated_at`            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`dojo_id`),
  CONSTRAINT `fk_dps_dojo` FOREIGN KEY (`dojo_id`) REFERENCES `dojos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =====================================================================
-- 2. PERSONAS (globales) — users / user_profiles / user_settings
-- =====================================================================

CREATE TABLE `users` (
  `id`                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email`               VARCHAR(150) NULL COMMENT 'NULL permitido para menores sin email propio',
  `username`            VARCHAR(100) NULL,
  `password_hash`       VARCHAR(100) NULL COMMENT 'NULL = no puede iniciar sesión (p.ej. menor gestionado por tutor)',
  `email_verified_at`   DATETIME NULL,
  `is_superadmin`       TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'operador de la plataforma BudoDesk',
  `status`              ENUM('active','locked','disabled') NOT NULL DEFAULT 'active',
  `failed_login_count`  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `locked_until`        DATETIME NULL,
  `password_changed_at` DATETIME NULL,
  `last_login_at`       DATETIME NULL,
  `last_seen_at`        DATETIME NULL,
  `created_at`          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`          DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  UNIQUE KEY `uq_users_username` (`username`)
) ENGINE=InnoDB;

CREATE TABLE `user_profiles` (
  `user_id`                 INT UNSIGNED NOT NULL,
  `first_name`              VARCHAR(100) NOT NULL,
  `last_name`               VARCHAR(100) NULL,
  `second_last_name`        VARCHAR(100) NULL,
  `preferred_name`          VARCHAR(100) NULL,
  `gender`                  ENUM('male','female','other','undisclosed') NULL,
  `date_of_birth`           DATE NULL,
  `phone`                   VARCHAR(30) NULL,
  `photo_url`               VARCHAR(500) NULL,
  `address_line1`           VARCHAR(200) NULL,
  `address_line2`           VARCHAR(200) NULL,
  `city`                    VARCHAR(100) NULL,
  `state`                   VARCHAR(100) NULL,
  `postal_code`             VARCHAR(20) NULL,
  `country_code`            CHAR(2) NULL,
  `emergency_contact_name`  VARCHAR(150) NULL,
  `emergency_contact_phone` VARCHAR(30) NULL,
  `emergency_contact_relation` VARCHAR(50) NULL,
  -- Datos sensibles: solo los ve admin/instructor del dojo y el propio usuario/tutor.
  `blood_type`              VARCHAR(5) NULL,
  `medical_notes`           TEXT NULL,
  `created_at`              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  KEY `idx_up_name` (`last_name`,`first_name`),
  CONSTRAINT `fk_up_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE `user_settings` (
  `user_id`         INT UNSIGNED NOT NULL,
  `language`        VARCHAR(5) NULL,
  `theme`           ENUM('system','light','dark') NOT NULL DEFAULT 'system',
  `last_dojo_id`    INT UNSIGNED NULL COMMENT 'dojo que se abre por defecto al iniciar sesión',
  `notify_email`    TINYINT(1) NOT NULL DEFAULT 1,
  `notify_push`     TINYINT(1) NOT NULL DEFAULT 1,
  `notify_class_reminders`   TINYINT(1) NOT NULL DEFAULT 1,
  `notify_payment_reminders` TINYINT(1) NOT NULL DEFAULT 1,
  `notify_announcements`     TINYINT(1) NOT NULL DEFAULT 1,
  `updated_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_us_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_us_dojo` FOREIGN KEY (`last_dojo_id`) REFERENCES `dojos` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Tutores legales (relación entre personas, vale para cualquier dojo)
CREATE TABLE `user_guardians` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `guardian_user_id` INT UNSIGNED NOT NULL,
  `minor_user_id`    INT UNSIGNED NOT NULL,
  `relationship`     ENUM('mother','father','legal_guardian','grandparent','other') NOT NULL DEFAULT 'legal_guardian',
  `is_primary`       TINYINT(1) NOT NULL DEFAULT 1,
  `can_book`         TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'puede reservar clases por el menor',
  `can_pay`          TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_guardian_minor` (`guardian_user_id`,`minor_user_id`),
  KEY `idx_ug_minor` (`minor_user_id`),
  CONSTRAINT `fk_ug_guardian` FOREIGN KEY (`guardian_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ug_minor`    FOREIGN KEY (`minor_user_id`)    REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_ug_not_self` CHECK (`guardian_user_id` <> `minor_user_id`)
) ENGINE=InnoDB;

-- =====================================================================
-- 3. PERTENENCIA A DOJOS Y ROLES
-- =====================================================================

CREATE TABLE `dojo_members` (
  `dojo_id`        INT UNSIGNED NOT NULL,
  `user_id`        INT UNSIGNED NOT NULL,
  `member_number`  VARCHAR(30) NULL COMMENT 'número de socio visible / para QR',
  `status`         ENUM('pending','active','inactive','suspended') NOT NULL DEFAULT 'pending',
  `joined_at`      DATE NULL,
  `left_at`        DATE NULL,
  `left_reason`    VARCHAR(255) NULL,
  `source`         ENUM('admin','self_registration','invitation','import') NOT NULL DEFAULT 'admin',
  `notes`          TEXT NULL COMMENT 'notas internas del dojo sobre la persona',
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`dojo_id`,`user_id`),
  UNIQUE KEY `uq_dm_number` (`dojo_id`,`member_number`),
  KEY `idx_dm_user` (`user_id`),
  KEY `idx_dm_status` (`dojo_id`,`status`),
  CONSTRAINT `fk_dm_dojo` FOREIGN KEY (`dojo_id`) REFERENCES `dojos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_dm_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Una persona puede tener varios roles en el mismo dojo (instructor y alumno,
-- tutor y alumno…). El JWT lleva { userId, dojoId, roles[] }.
CREATE TABLE `dojo_member_roles` (
  `dojo_id`    INT UNSIGNED NOT NULL,
  `user_id`    INT UNSIGNED NOT NULL,
  `role`       ENUM('owner','admin','instructor','staff','student','guardian') NOT NULL,
  `granted_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `granted_by` INT UNSIGNED NULL,
  PRIMARY KEY (`dojo_id`,`user_id`,`role`),
  KEY `idx_dmr_role` (`dojo_id`,`role`),
  CONSTRAINT `fk_dmr_member` FOREIGN KEY (`dojo_id`,`user_id`) REFERENCES `dojo_members` (`dojo_id`,`user_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_dmr_granted_by` FOREIGN KEY (`granted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Invitaciones (el admin invita por email; el alumno crea su contraseña)
CREATE TABLE `dojo_invitations` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dojo_id`     INT UNSIGNED NOT NULL,
  `email`       VARCHAR(150) NOT NULL,
  `role`        ENUM('admin','instructor','staff','student','guardian') NOT NULL DEFAULT 'student',
  `token_hash`  CHAR(64) NOT NULL,
  `expires_at`  DATETIME NOT NULL,
  `accepted_at` DATETIME NULL,
  `invited_by`  INT UNSIGNED NULL,
  `created_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_inv_token` (`token_hash`),
  KEY `idx_inv_dojo_email` (`dojo_id`,`email`),
  CONSTRAINT `fk_inv_dojo` FOREIGN KEY (`dojo_id`) REFERENCES `dojos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_inv_by`   FOREIGN KEY (`invited_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- =====================================================================
-- 4. AUTENTICACIÓN Y CONSENTIMIENTOS
-- =====================================================================

-- Access token corto (15 min, en memoria) + refresh token rotativo (30 días).
-- Se guarda solo el HASH del refresh token. Reemplaza revoked_tokens.
CREATE TABLE `auth_sessions` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`            INT UNSIGNED NOT NULL,
  `dojo_id`            INT UNSIGNED NULL COMMENT 'dojo activo de la sesión; el refresh lo conserva',
  `refresh_token_hash` CHAR(64) NOT NULL,
  `family_id`          CHAR(36) NOT NULL COMMENT 'detecta reuso de refresh token robado',
  `user_agent`         VARCHAR(255) NULL,
  `ip_address`         VARCHAR(45) NULL,
  `expires_at`         DATETIME NOT NULL,
  `revoked_at`         DATETIME NULL,
  `last_used_at`       DATETIME NULL,
  `created_at`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_as_hash` (`refresh_token_hash`),
  KEY `idx_as_user` (`user_id`),
  KEY `idx_as_family` (`family_id`),
  KEY `idx_as_expires` (`expires_at`),
  CONSTRAINT `fk_as_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_as_dojo` FOREIGN KEY (`dojo_id`) REFERENCES `dojos` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Verificación de email y reseteo de contraseña en una sola tabla.
CREATE TABLE `user_tokens` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED NOT NULL,
  `purpose`     ENUM('email_verification','password_reset') NOT NULL,
  `token_hash`  CHAR(64) NOT NULL,
  `expires_at`  DATETIME NOT NULL,
  `used_at`     DATETIME NULL,
  `created_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ut_hash` (`token_hash`),
  KEY `idx_ut_user_purpose` (`user_id`,`purpose`),
  CONSTRAINT `fk_ut_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE `login_history` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED NULL,
  `dojo_id`     INT UNSIGNED NULL,
  `identifier`  VARCHAR(150) NULL COMMENT 'email/usuario intentado (para intentos fallidos)',
  `success`     TINYINT(1) NOT NULL,
  `ip_address`  VARCHAR(45) NULL,
  `user_agent`  VARCHAR(255) NULL,
  `created_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lh_user` (`user_id`,`created_at`),
  KEY `idx_lh_ip` (`ip_address`,`created_at`),
  CONSTRAINT `fk_lh_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_lh_dojo` FOREIGN KEY (`dojo_id`) REFERENCES `dojos` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Historial de aceptación de aviso de privacidad / términos (LFPDPPP).
-- Reemplaza las columnas privacy_* de users.
CREATE TABLE `user_consents` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       INT UNSIGNED NOT NULL,
  `dojo_id`       INT UNSIGNED NULL COMMENT 'NULL = aviso de la plataforma BudoDesk',
  `document`      ENUM('privacy_notice','terms','minor_consent','image_rights') NOT NULL,
  `version`       VARCHAR(10) NOT NULL,
  `accepted`      TINYINT(1) NOT NULL DEFAULT 1,
  `on_behalf_of`  INT UNSIGNED NULL COMMENT 'tutor que acepta por un menor',
  `ip_address`    VARCHAR(45) NULL,
  `created_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_uc_user_doc` (`user_id`,`document`,`created_at`),
  CONSTRAINT `fk_uc_user`   FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_uc_dojo`   FOREIGN KEY (`dojo_id`) REFERENCES `dojos` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_uc_behalf` FOREIGN KEY (`on_behalf_of`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- =====================================================================
-- 5. DISCIPLINAS Y SISTEMA DE GRADOS
-- =====================================================================

CREATE TABLE `disciplines` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dojo_id`     INT UNSIGNED NOT NULL,
  `name`        VARCHAR(150) NOT NULL,
  `style`       VARCHAR(150) NULL COMMENT 'Tendoryu, Shotokan, Gracie…',
  `description` TEXT NULL,
  `color`       CHAR(7) NULL,
  `sort_order`  SMALLINT NOT NULL DEFAULT 0,
  `active`      TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_disc_dojo_id` (`dojo_id`,`id`),
  UNIQUE KEY `uq_disc_dojo_name` (`dojo_id`,`name`),
  CONSTRAINT `fk_disc_dojo` FOREIGN KEY (`dojo_id`) REFERENCES `dojos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Rutas de grados dentro de una disciplina: "Adultos", "Infantil (4-12)"…
-- Toda disciplina tiene al menos una (se crea "General" por defecto).
CREATE TABLE `rank_tracks` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dojo_id`       INT UNSIGNED NOT NULL,
  `discipline_id` INT UNSIGNED NOT NULL,
  `name`          VARCHAR(100) NOT NULL,
  `min_age`       TINYINT UNSIGNED NULL,
  `max_age`       TINYINT UNSIGNED NULL,
  `display_style` ENUM('rank','belt') NOT NULL DEFAULT 'rank'
                  COMMENT 'rank = se muestra el grado (5to Kyu), la cinta es secundaria; belt = se muestra la cinta de color (Cinta amarilla · 6to Kyu)',
  `sort_order`    SMALLINT NOT NULL DEFAULT 0,
  `active`        TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rt_dojo_id` (`dojo_id`,`id`),
  UNIQUE KEY `uq_rt_name` (`dojo_id`,`discipline_id`,`name`),
  CONSTRAINT `fk_rt_disc` FOREIGN KEY (`dojo_id`,`discipline_id`) REFERENCES `disciplines` (`dojo_id`,`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE `ranks` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dojo_id`          INT UNSIGNED NOT NULL,
  `discipline_id`    INT UNSIGNED NOT NULL,
  `track_id`         INT UNSIGNED NOT NULL,
  `name`             VARCHAR(100) NOT NULL COMMENT '6to Kyu',
  `short_name`       VARCHAR(30)  NULL,
  `level`            SMALLINT NOT NULL COMMENT 'orden ascendente dentro del track',
  `kind`             ENUM('kyu','dan','belt','other') NOT NULL DEFAULT 'belt',
  `color`            CHAR(7) NOT NULL DEFAULT '#FFFFFF' COMMENT 'color principal del cinturón',
  `stripe_color`     CHAR(7) NULL COMMENT 'franja central (cintas infantiles bicolor)',
  `max_stripes`      TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'tips/grados intermedios',
  `min_months`       SMALLINT UNSIGNED NULL COMMENT 'tiempo mínimo en el grado ANTERIOR',
  `min_classes`      SMALLINT UNSIGNED NULL COMMENT 'asistencias mínimas en el grado anterior',
  `min_age`          TINYINT UNSIGNED NULL,
  `requires_exam`    TINYINT(1) NOT NULL DEFAULT 1,
  `exam_fee`         DECIMAL(10,2) NULL,
  `description`      TEXT NULL,
  `active`           TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rank_dojo_id` (`dojo_id`,`id`),
  UNIQUE KEY `uq_rank_level` (`dojo_id`,`track_id`,`level`),
  KEY `idx_rank_disc` (`dojo_id`,`discipline_id`),
  CONSTRAINT `fk_rank_disc`  FOREIGN KEY (`dojo_id`,`discipline_id`) REFERENCES `disciplines` (`dojo_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_rank_track` FOREIGN KEY (`dojo_id`,`track_id`)      REFERENCES `rank_tracks` (`dojo_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Temario por grado: katas, técnicas, teoría…
CREATE TABLE `rank_requirements` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dojo_id`     INT UNSIGNED NOT NULL,
  `rank_id`     INT UNSIGNED NOT NULL,
  `category`    ENUM('technique','kata','sparring','theory','conduct','other') NOT NULL DEFAULT 'technique',
  `name`        VARCHAR(150) NOT NULL,
  `description` TEXT NULL,
  `video_url`   VARCHAR(500) NULL,
  `sort_order`  SMALLINT NOT NULL DEFAULT 0,
  `mandatory`   TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rr_dojo_id` (`dojo_id`,`id`),
  KEY `idx_rr_rank` (`dojo_id`,`rank_id`,`sort_order`),
  CONSTRAINT `fk_rr_rank` FOREIGN KEY (`dojo_id`,`rank_id`) REFERENCES `ranks` (`dojo_id`,`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Grado ACTUAL de cada alumno por disciplina (uno por disciplina).
CREATE TABLE `member_ranks` (
  `dojo_id`        INT UNSIGNED NOT NULL,
  `user_id`        INT UNSIGNED NOT NULL,
  `discipline_id`  INT UNSIGNED NOT NULL,
  `rank_id`        INT UNSIGNED NOT NULL,
  `stripes`        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `since_date`     DATE NOT NULL,
  `next_exam_date` DATE NULL,
  `started_discipline_at` DATE NULL COMMENT 'cuándo empezó a practicar esta disciplina',
  `updated_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`dojo_id`,`user_id`,`discipline_id`),
  KEY `idx_mr_rank` (`dojo_id`,`rank_id`),
  CONSTRAINT `fk_mr_member` FOREIGN KEY (`dojo_id`,`user_id`)       REFERENCES `dojo_members` (`dojo_id`,`user_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mr_disc`   FOREIGN KEY (`dojo_id`,`discipline_id`) REFERENCES `disciplines` (`dojo_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_mr_rank`   FOREIGN KEY (`dojo_id`,`rank_id`)       REFERENCES `ranks` (`dojo_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Bitácora inmutable de grados (promociones, tips, grado inicial, correcciones)
CREATE TABLE `rank_history` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dojo_id`            INT UNSIGNED NOT NULL,
  `user_id`            INT UNSIGNED NOT NULL,
  `discipline_id`      INT UNSIGNED NOT NULL,
  `rank_id`            INT UNSIGNED NOT NULL,
  `stripes`            TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `event_type`         ENUM('initial','promotion','stripe','demotion','correction','transfer') NOT NULL DEFAULT 'promotion',
  `awarded_date`       DATE NOT NULL,
  `exam_candidate_id`  BIGINT UNSIGNED NULL,
  `score`              DECIMAL(5,2) NULL,
  `certificate_number` VARCHAR(50) NULL,
  `certificate_url`    VARCHAR(500) NULL,
  `awarded_by`         INT UNSIGNED NULL,
  `notes`              TEXT NULL,
  `created_at`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rh_cert` (`dojo_id`,`certificate_number`),
  KEY `idx_rh_user` (`dojo_id`,`user_id`,`discipline_id`,`awarded_date`),
  CONSTRAINT `fk_rh_member` FOREIGN KEY (`dojo_id`,`user_id`)       REFERENCES `dojo_members` (`dojo_id`,`user_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rh_disc`   FOREIGN KEY (`dojo_id`,`discipline_id`) REFERENCES `disciplines` (`dojo_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_rh_rank`   FOREIGN KEY (`dojo_id`,`rank_id`)       REFERENCES `ranks` (`dojo_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_rh_by`     FOREIGN KEY (`awarded_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Avance del alumno en el temario del grado al que aspira
CREATE TABLE `member_requirement_progress` (
  `dojo_id`        INT UNSIGNED NOT NULL,
  `user_id`        INT UNSIGNED NOT NULL,
  `requirement_id` INT UNSIGNED NOT NULL,
  `status`         ENUM('pending','in_progress','approved') NOT NULL DEFAULT 'pending',
  `evaluated_by`   INT UNSIGNED NULL,
  `evaluated_at`   DATETIME NULL,
  `notes`          VARCHAR(500) NULL,
  PRIMARY KEY (`dojo_id`,`user_id`,`requirement_id`),
  CONSTRAINT `fk_mrp_member` FOREIGN KEY (`dojo_id`,`user_id`)        REFERENCES `dojo_members` (`dojo_id`,`user_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mrp_req`    FOREIGN KEY (`dojo_id`,`requirement_id`) REFERENCES `rank_requirements` (`dojo_id`,`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mrp_by`     FOREIGN KEY (`evaluated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Eventos de examen
CREATE TABLE `exams` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dojo_id`       INT UNSIGNED NOT NULL,
  `discipline_id` INT UNSIGNED NOT NULL,
  `location_id`   INT UNSIGNED NULL,
  `title`         VARCHAR(150) NOT NULL,
  `exam_date`     DATE NOT NULL,
  `start_time`    TIME NULL,
  `examiner_name` VARCHAR(150) NULL COMMENT 'sensei externo, si aplica',
  `examiner_user_id` INT UNSIGNED NULL,
  `registration_deadline` DATE NULL,
  `status`        ENUM('planned','open','closed','completed','cancelled') NOT NULL DEFAULT 'planned',
  `notes`         TEXT NULL,
  `created_by`    INT UNSIGNED NULL,
  `created_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_exam_dojo_id` (`dojo_id`,`id`),
  KEY `idx_exam_date` (`dojo_id`,`exam_date`),
  CONSTRAINT `fk_exam_disc` FOREIGN KEY (`dojo_id`,`discipline_id`) REFERENCES `disciplines` (`dojo_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_exam_loc`  FOREIGN KEY (`dojo_id`,`location_id`)   REFERENCES `dojo_locations` (`dojo_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_exam_examiner` FOREIGN KEY (`examiner_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_exam_by`   FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE `exam_candidates` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dojo_id`         INT UNSIGNED NOT NULL,
  `exam_id`         INT UNSIGNED NOT NULL,
  `user_id`         INT UNSIGNED NOT NULL,
  `from_rank_id`    INT UNSIGNED NULL,
  `target_rank_id`  INT UNSIGNED NOT NULL,
  `status`          ENUM('invited','registered','passed','failed','absent','withdrawn') NOT NULL DEFAULT 'invited',
  `score`           DECIMAL(5,2) NULL,
  `feedback`        TEXT NULL COMMENT 'retroalimentación visible para el alumno',
  `charge_id`       BIGINT UNSIGNED NULL COMMENT 'cargo de la cuota de examen',
  `result_by`       INT UNSIGNED NULL,
  `result_at`       DATETIME NULL,
  `created_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ec_dojo_id` (`dojo_id`,`id`),
  UNIQUE KEY `uq_ec_exam_user` (`exam_id`,`user_id`),
  KEY `idx_ec_user` (`dojo_id`,`user_id`),
  CONSTRAINT `fk_ec_exam`   FOREIGN KEY (`dojo_id`,`exam_id`)        REFERENCES `exams` (`dojo_id`,`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ec_member` FOREIGN KEY (`dojo_id`,`user_id`)        REFERENCES `dojo_members` (`dojo_id`,`user_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ec_from`   FOREIGN KEY (`dojo_id`,`from_rank_id`)   REFERENCES `ranks` (`dojo_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_ec_target` FOREIGN KEY (`dojo_id`,`target_rank_id`) REFERENCES `ranks` (`dojo_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_ec_by`     FOREIGN KEY (`result_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- =====================================================================
-- 6. CLASES: series recurrentes, sesiones y reservas/asistencia
-- =====================================================================

-- Plantilla recurrente ("Lunes y miércoles 19:00 Aikido adultos")
CREATE TABLE `class_series` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dojo_id`         INT UNSIGNED NOT NULL,
  `discipline_id`   INT UNSIGNED NULL,
  `location_id`     INT UNSIGNED NULL,
  `instructor_id`   INT UNSIGNED NULL,
  `title`           VARCHAR(150) NOT NULL,
  `description`     TEXT NULL,
  `days_of_week`    SET('mon','tue','wed','thu','fri','sat','sun') NOT NULL,
  `start_time`      TIME NOT NULL,
  `end_time`        TIME NOT NULL,
  `starts_on`       DATE NOT NULL,
  `ends_on`         DATE NULL COMMENT 'NULL = indefinida; un job genera sesiones N semanas adelante',
  `capacity`        SMALLINT UNSIGNED NULL COMMENT 'NULL = sin límite',
  `min_age`         TINYINT UNSIGNED NULL,
  `max_age`         TINYINT UNSIGNED NULL,
  `min_rank_level`  SMALLINT NULL,
  `max_rank_level`  SMALLINT NULL,
  `color`           CHAR(7) NULL,
  `active`          TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cs_dojo_id` (`dojo_id`,`id`),
  CONSTRAINT `fk_cs_disc` FOREIGN KEY (`dojo_id`,`discipline_id`) REFERENCES `disciplines` (`dojo_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_cs_loc`  FOREIGN KEY (`dojo_id`,`location_id`)   REFERENCES `dojo_locations` (`dojo_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_cs_inst` FOREIGN KEY (`dojo_id`,`instructor_id`) REFERENCES `dojo_members` (`dojo_id`,`user_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_cs_time` CHECK (`end_time` > `start_time`)
) ENGINE=InnoDB;

-- Cada clase concreta en el calendario
CREATE TABLE `class_sessions` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dojo_id`         INT UNSIGNED NOT NULL,
  `series_id`       INT UNSIGNED NULL,
  `discipline_id`   INT UNSIGNED NULL,
  `location_id`     INT UNSIGNED NULL,
  `instructor_id`   INT UNSIGNED NULL,
  `title`           VARCHAR(150) NOT NULL,
  `session_date`    DATE NOT NULL,
  `start_time`      TIME NOT NULL,
  `end_time`        TIME NOT NULL,
  `capacity`        SMALLINT UNSIGNED NULL,
  `booked_count`    SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'mantenido en la misma transacción que la reserva',
  `status`          ENUM('scheduled','cancelled','completed') NOT NULL DEFAULT 'scheduled',
  `is_modified`     TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = editada a mano; el job de la serie no la sobrescribe',
  `cancel_reason`   VARCHAR(255) NULL,
  `checkin_code`    CHAR(8) NULL COMMENT 'código/QR del día para auto check-in',
  `notes`           TEXT NULL,
  `created_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sess_dojo_id` (`dojo_id`,`id`),
  UNIQUE KEY `uq_sess_series_date` (`series_id`,`session_date`),
  KEY `idx_sess_date` (`dojo_id`,`session_date`,`start_time`),
  KEY `idx_sess_inst` (`dojo_id`,`instructor_id`,`session_date`),
  CONSTRAINT `fk_sess_series` FOREIGN KEY (`dojo_id`,`series_id`)     REFERENCES `class_series` (`dojo_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_sess_disc`   FOREIGN KEY (`dojo_id`,`discipline_id`) REFERENCES `disciplines` (`dojo_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_sess_loc`    FOREIGN KEY (`dojo_id`,`location_id`)   REFERENCES `dojo_locations` (`dojo_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_sess_inst`   FOREIGN KEY (`dojo_id`,`instructor_id`) REFERENCES `dojo_members` (`dojo_id`,`user_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_sess_time`  CHECK (`end_time` > `start_time`)
) ENGINE=InnoDB;

-- Reserva + asistencia en una sola fila.
-- Una asistencia sin reserva previa (walk-in) = fila con status 'attended'.
CREATE TABLE `class_bookings` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dojo_id`         INT UNSIGNED NOT NULL,
  `session_id`      INT UNSIGNED NOT NULL,
  `user_id`         INT UNSIGNED NOT NULL,
  `membership_id`   INT UNSIGNED NULL COMMENT 'membresía que cubrió la clase (descuenta de paquetes)',
  `status`          ENUM('booked','waitlisted','cancelled','late_cancel','attended','no_show') NOT NULL DEFAULT 'booked',
  `waitlist_position` SMALLINT UNSIGNED NULL,
  `booked_by`       INT UNSIGNED NULL COMMENT 'el alumno, su tutor o un admin',
  `booked_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cancelled_at`    DATETIME NULL,
  `checked_in_at`   DATETIME NULL,
  `checked_in_by`   INT UNSIGNED NULL,
  `checkin_method`  ENUM('manual','qr','self','kiosk') NULL,
  `notes`           VARCHAR(255) NULL,
  `updated_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cb_session_user` (`session_id`,`user_id`) COMMENT 'cancelar y volver a reservar = UPDATE de esta fila',
  KEY `idx_cb_user` (`dojo_id`,`user_id`,`status`),
  KEY `idx_cb_session_status` (`dojo_id`,`session_id`,`status`),
  KEY `idx_cb_membership` (`dojo_id`,`membership_id`),
  CONSTRAINT `fk_cb_session` FOREIGN KEY (`dojo_id`,`session_id`) REFERENCES `class_sessions` (`dojo_id`,`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cb_member`  FOREIGN KEY (`dojo_id`,`user_id`)    REFERENCES `dojo_members` (`dojo_id`,`user_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cb_ms`      FOREIGN KEY (`dojo_id`,`membership_id`) REFERENCES `memberships` (`dojo_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_cb_booked_by`  FOREIGN KEY (`booked_by`)     REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_cb_checkin_by` FOREIGN KEY (`checked_in_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- =====================================================================
-- 7. PLANES Y MEMBRESÍAS
-- =====================================================================

-- Lo que el dojo vende (antes "packages")
CREATE TABLE `plans` (
  `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dojo_id`            INT UNSIGNED NOT NULL,
  `name`               VARCHAR(100) NOT NULL,
  `description`        TEXT NULL,
  `billing_type`       ENUM('recurring','class_pack','one_time','trial') NOT NULL DEFAULT 'recurring',
  `interval_unit`      ENUM('week','month','year') NULL COMMENT 'solo recurring',
  `interval_count`     TINYINT UNSIGNED NULL DEFAULT 1 COMMENT 'cada 1 mes, cada 3 meses…',
  `price`              DECIMAL(10,2) NOT NULL,
  `currency`           CHAR(3) NOT NULL DEFAULT 'MXN',
  `signup_fee`         DECIMAL(10,2) NULL COMMENT 'inscripción',
  `sessions_per_week`  TINYINT UNSIGNED NULL COMMENT 'NULL = ilimitado',
  `total_sessions`     SMALLINT UNSIGNED NULL COMMENT 'class_pack: 10 clases',
  `validity_days`      SMALLINT UNSIGNED NULL COMMENT 'class_pack/trial: vence en N días',
  `max_members`        TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '>1 = plan familiar',
  `all_disciplines`    TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0 = solo las de plan_disciplines',
  `visible_to_students` TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'aparece en el catálogo para contratar/pagar en línea',
  `sort_order`         SMALLINT NOT NULL DEFAULT 0,
  `active`             TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_plan_dojo_id` (`dojo_id`,`id`),
  UNIQUE KEY `uq_plan_name` (`dojo_id`,`name`),
  CONSTRAINT `fk_plan_dojo` FOREIGN KEY (`dojo_id`) REFERENCES `dojos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_plan_recurring` CHECK (`billing_type` <> 'recurring' OR `interval_unit` IS NOT NULL),
  CONSTRAINT `chk_plan_pack` CHECK (`billing_type` <> 'class_pack' OR `total_sessions` IS NOT NULL)
) ENGINE=InnoDB;

CREATE TABLE `plan_disciplines` (
  `dojo_id`       INT UNSIGNED NOT NULL,
  `plan_id`       INT UNSIGNED NOT NULL,
  `discipline_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`dojo_id`,`plan_id`,`discipline_id`),
  CONSTRAINT `fk_pd_plan` FOREIGN KEY (`dojo_id`,`plan_id`)       REFERENCES `plans` (`dojo_id`,`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pd_disc` FOREIGN KEY (`dojo_id`,`discipline_id`) REFERENCES `disciplines` (`dojo_id`,`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Catálogo de descuentos del dojo: "Familiar 20%", "Beca", "Instructor"…
CREATE TABLE `discounts` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dojo_id`     INT UNSIGNED NOT NULL,
  `name`        VARCHAR(100) NOT NULL,
  `type`        ENUM('percent','fixed') NOT NULL,
  `value`       DECIMAL(10,2) NOT NULL,
  `description` VARCHAR(255) NULL,
  `active`      TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_disc_cat_dojo_id` (`dojo_id`,`id`),
  UNIQUE KEY `uq_disc_cat_name` (`dojo_id`,`name`),
  CONSTRAINT `fk_dcat_dojo` FOREIGN KEY (`dojo_id`) REFERENCES `dojos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_dcat_value` CHECK (`value` > 0 AND (`type` <> 'percent' OR `value` <= 100))
) ENGINE=InnoDB;

-- Contrato de un plan. Precio y reglas se copian (snapshot) para que
-- cambiar el plan no altere membresías existentes.
CREATE TABLE `memberships` (
  `id`                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dojo_id`               INT UNSIGNED NOT NULL,
  `plan_id`               INT UNSIGNED NOT NULL,
  `payer_user_id`         INT UNSIGNED NOT NULL COMMENT 'quien paga (alumno o tutor)',
  `status`                ENUM('pending','active','paused','past_due','cancelled','expired') NOT NULL DEFAULT 'pending',
  `start_date`            DATE NOT NULL,
  `end_date`              DATE NULL COMMENT 'NULL = recurrente sin fin',
  `current_period_start`  DATE NULL,
  `current_period_end`    DATE NULL,
  `next_billing_date`     DATE NULL,
  `price`                 DECIMAL(10,2) NOT NULL,
  `currency`              CHAR(3) NOT NULL,
  `discount_id`           INT UNSIGNED NULL COMMENT 'descuento del catálogo aplicado',
  `discount_type`         ENUM('none','percent','fixed') NOT NULL DEFAULT 'none' COMMENT 'snapshot del descuento al contratar',
  `discount_value`        DECIMAL(10,2) NULL,
  `discount_reason`       VARCHAR(150) NULL COMMENT 'texto libre o nombre del descuento',
  `sessions_per_week`     TINYINT UNSIGNED NULL,
  `sessions_remaining`    SMALLINT UNSIGNED NULL COMMENT 'class_pack',
  `auto_renew`            TINYINT(1) NOT NULL DEFAULT 1,
  `cancel_at_period_end`  TINYINT(1) NOT NULL DEFAULT 0,
  `cancelled_at`          DATETIME NULL,
  `cancel_reason`         VARCHAR(255) NULL,
  `notes`                 TEXT NULL,
  `created_by`            INT UNSIGNED NULL,
  `created_at`            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ms_dojo_id` (`dojo_id`,`id`),
  KEY `idx_ms_status` (`dojo_id`,`status`,`current_period_end`),
  KEY `idx_ms_billing` (`dojo_id`,`next_billing_date`),
  KEY `idx_ms_payer` (`dojo_id`,`payer_user_id`),
  CONSTRAINT `fk_ms_plan`  FOREIGN KEY (`dojo_id`,`plan_id`)       REFERENCES `plans` (`dojo_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_ms_payer` FOREIGN KEY (`dojo_id`,`payer_user_id`) REFERENCES `dojo_members` (`dojo_id`,`user_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_ms_discount` FOREIGN KEY (`dojo_id`,`discount_id`) REFERENCES `discounts` (`dojo_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_ms_by`    FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Quiénes entrenan con esa membresía (1 en individual, varios en familiar)
CREATE TABLE `membership_members` (
  `dojo_id`       INT UNSIGNED NOT NULL,
  `membership_id` INT UNSIGNED NOT NULL,
  `user_id`       INT UNSIGNED NOT NULL,
  `added_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`dojo_id`,`membership_id`,`user_id`),
  KEY `idx_mm_user` (`dojo_id`,`user_id`),
  CONSTRAINT `fk_mm_ms`     FOREIGN KEY (`dojo_id`,`membership_id`) REFERENCES `memberships` (`dojo_id`,`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mm_member` FOREIGN KEY (`dojo_id`,`user_id`)       REFERENCES `dojo_members` (`dojo_id`,`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Congelamientos (lesión, vacaciones). Extienden el periodo.
CREATE TABLE `membership_pauses` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dojo_id`       INT UNSIGNED NOT NULL,
  `membership_id` INT UNSIGNED NOT NULL,
  `start_date`    DATE NOT NULL,
  `end_date`      DATE NOT NULL,
  `reason`        VARCHAR(255) NULL,
  `created_by`    INT UNSIGNED NULL,
  `created_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mp_ms` (`dojo_id`,`membership_id`),
  CONSTRAINT `fk_mp_ms` FOREIGN KEY (`dojo_id`,`membership_id`) REFERENCES `memberships` (`dojo_id`,`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mp_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_mp_dates` CHECK (`end_date` >= `start_date`)
) ENGINE=InnoDB;

-- =====================================================================
-- 8. COBRANZA: cargos, pagos y su aplicación
-- =====================================================================

-- Lo que se DEBE. Lo genera el job de facturación, un examen, o el admin.
CREATE TABLE `charges` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dojo_id`         INT UNSIGNED NOT NULL,
  `user_id`         INT UNSIGNED NOT NULL COMMENT 'responsable de pago',
  `membership_id`   INT UNSIGNED NULL,
  `type`            ENUM('membership','signup_fee','exam_fee','late_fee','event','product','adjustment','other') NOT NULL,
  `description`     VARCHAR(255) NOT NULL,
  `period_start`    DATE NULL,
  `period_end`      DATE NULL,
  `amount`          DECIMAL(10,2) NOT NULL,
  `discount_amount` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `total`           DECIMAL(10,2) AS (`amount` - `discount_amount`) STORED,
  `amount_paid`     DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'suma de payment_allocations, mantenida en transacción',
  `currency`        CHAR(3) NOT NULL,
  `due_date`        DATE NOT NULL,
  `status`          ENUM('pending','partial','paid','void','refunded') NOT NULL DEFAULT 'pending',
  `voided_reason`   VARCHAR(255) NULL,
  `created_by`      INT UNSIGNED NULL,
  `created_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ch_dojo_id` (`dojo_id`,`id`),
  UNIQUE KEY `uq_ch_ms_period` (`membership_id`,`type`,`period_start`) COMMENT 'el job no duplica cargos del mismo periodo',
  KEY `idx_ch_user_status` (`dojo_id`,`user_id`,`status`),
  KEY `idx_ch_due` (`dojo_id`,`status`,`due_date`),
  CONSTRAINT `fk_ch_member` FOREIGN KEY (`dojo_id`,`user_id`)       REFERENCES `dojo_members` (`dojo_id`,`user_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_ch_ms`     FOREIGN KEY (`dojo_id`,`membership_id`) REFERENCES `memberships` (`dojo_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_ch_by`     FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_ch_amounts` CHECK (`amount` >= 0 AND `discount_amount` >= 0 AND `discount_amount` <= `amount`)
) ENGINE=InnoDB;

-- Lo que se PAGÓ (efectivo, transferencia, PayPal…)
CREATE TABLE `payments` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dojo_id`             INT UNSIGNED NOT NULL,
  `user_id`             INT UNSIGNED NOT NULL COMMENT 'quien pagó',
  `amount`              DECIMAL(10,2) NOT NULL,
  `currency`            CHAR(3) NOT NULL,
  `method`              ENUM('cash','transfer','card','paypal','other') NOT NULL,
  `status`              ENUM('pending','completed','failed','refunded','partially_refunded','cancelled') NOT NULL DEFAULT 'pending',
  `paid_at`             DATETIME NULL,
  `reference`           VARCHAR(100) NULL COMMENT 'folio de transferencia, recibo…',
  `receipt_url`         VARCHAR(500) NULL COMMENT 'comprobante subido por el alumno',
  `provider`            ENUM('paypal') NULL,
  `provider_order_id`   VARCHAR(64) NULL,
  `provider_capture_id` VARCHAR(64) NULL,
  `provider_fee`        DECIMAL(10,2) NULL COMMENT 'comisión cobrada por PayPal',
  `refunded_amount`     DECIMAL(10,2) NOT NULL DEFAULT 0,
  `received_by`         INT UNSIGNED NULL COMMENT 'admin que registró/validó',
  `notes`               VARCHAR(255) NULL,
  `created_at`          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pay_dojo_id` (`dojo_id`,`id`),
  UNIQUE KEY `uq_pay_order` (`provider`,`provider_order_id`),
  UNIQUE KEY `uq_pay_capture` (`provider`,`provider_capture_id`),
  KEY `idx_pay_user` (`dojo_id`,`user_id`,`paid_at`),
  KEY `idx_pay_date` (`dojo_id`,`status`,`paid_at`),
  CONSTRAINT `fk_pay_member` FOREIGN KEY (`dojo_id`,`user_id`) REFERENCES `dojo_members` (`dojo_id`,`user_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_pay_by`     FOREIGN KEY (`received_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_pay_amount` CHECK (`amount` > 0)
) ENGINE=InnoDB;

-- Qué cargos cubre cada pago (un pago puede cubrir varios y viceversa)
CREATE TABLE `payment_allocations` (
  `dojo_id`    INT UNSIGNED NOT NULL,
  `payment_id` BIGINT UNSIGNED NOT NULL,
  `charge_id`  BIGINT UNSIGNED NOT NULL,
  `amount`     DECIMAL(10,2) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`dojo_id`,`payment_id`,`charge_id`),
  KEY `idx_pa_charge` (`dojo_id`,`charge_id`),
  CONSTRAINT `fk_pa_payment` FOREIGN KEY (`dojo_id`,`payment_id`) REFERENCES `payments` (`dojo_id`,`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pa_charge`  FOREIGN KEY (`dojo_id`,`charge_id`)  REFERENCES `charges` (`dojo_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_pa_amount` CHECK (`amount` > 0)
) ENGINE=InnoDB;

-- Webhooks de PayPal: idempotencia y depuración
CREATE TABLE `payment_webhook_events` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dojo_id`       INT UNSIGNED NULL,
  `provider`      ENUM('paypal') NOT NULL DEFAULT 'paypal',
  `event_id`      VARCHAR(100) NOT NULL,
  `event_type`    VARCHAR(100) NOT NULL,
  `payload`       JSON NOT NULL,
  `verified`      TINYINT(1) NOT NULL DEFAULT 0,
  `processed_at`  DATETIME NULL,
  `error`         TEXT NULL,
  `received_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pwe_event` (`provider`,`event_id`),
  KEY `idx_pwe_pending` (`processed_at`),
  CONSTRAINT `fk_pwe_dojo` FOREIGN KEY (`dojo_id`) REFERENCES `dojos` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Agregamos ahora la FK de exam_candidates.charge_id (charges ya existe)
ALTER TABLE `exam_candidates`
  ADD CONSTRAINT `fk_ec_charge` FOREIGN KEY (`dojo_id`,`charge_id`) REFERENCES `charges` (`dojo_id`,`id`) ON DELETE RESTRICT;

ALTER TABLE `rank_history`
  ADD CONSTRAINT `fk_rh_exam` FOREIGN KEY (`dojo_id`,`exam_candidate_id`) REFERENCES `exam_candidates` (`dojo_id`,`id`) ON DELETE RESTRICT;

-- =====================================================================
-- 9. COMUNICACIÓN: avisos y notificaciones
-- =====================================================================

-- Avisos del dojo (tablón): "No hay clase el lunes", "Examen el 15"
CREATE TABLE `announcements` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dojo_id`      INT UNSIGNED NOT NULL,
  `title`        VARCHAR(150) NOT NULL,
  `body`         TEXT NOT NULL,
  `audience`     ENUM('all','students','guardians','staff','discipline') NOT NULL DEFAULT 'all',
  `discipline_id` INT UNSIGNED NULL,
  `pinned`       TINYINT(1) NOT NULL DEFAULT 0,
  `send_push`    TINYINT(1) NOT NULL DEFAULT 0,
  `send_email`   TINYINT(1) NOT NULL DEFAULT 0,
  `publish_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at`   DATETIME NULL,
  `created_by`   INT UNSIGNED NULL,
  `created_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ann_pub` (`dojo_id`,`publish_at`),
  CONSTRAINT `fk_ann_dojo` FOREIGN KEY (`dojo_id`) REFERENCES `dojos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ann_disc` FOREIGN KEY (`dojo_id`,`discipline_id`) REFERENCES `disciplines` (`dojo_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_ann_by`   FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Bandeja de cada usuario (in-app) + cola de envío por canal
CREATE TABLE `notifications` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dojo_id`     INT UNSIGNED NULL,
  `user_id`     INT UNSIGNED NOT NULL,
  `type`        VARCHAR(50) NOT NULL COMMENT 'class_reminder, payment_due, payment_received, rank_promoted, exam_invite, announcement…',
  `title`       VARCHAR(150) NOT NULL,
  `body`        VARCHAR(500) NULL,
  `data`        JSON NULL COMMENT 'deep link: {"screen":"payments","chargeId":12}',
  `read_at`     DATETIME NULL,
  `created_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_notif_user` (`user_id`,`read_at`,`created_at`),
  CONSTRAINT `fk_notif_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_notif_dojo` FOREIGN KEY (`dojo_id`) REFERENCES `dojos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE `notification_deliveries` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `notification_id` BIGINT UNSIGNED NOT NULL,
  `channel`         ENUM('push','email') NOT NULL,
  `status`          ENUM('queued','sent','failed','skipped') NOT NULL DEFAULT 'queued',
  `attempts`        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `next_attempt_at` DATETIME NULL,
  `sent_at`         DATETIME NULL,
  `error`           VARCHAR(500) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_nd_channel` (`notification_id`,`channel`),
  KEY `idx_nd_queue` (`status`,`next_attempt_at`),
  CONSTRAINT `fk_nd_notif` FOREIGN KEY (`notification_id`) REFERENCES `notifications` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Tokens de Expo Push por dispositivo
CREATE TABLE `push_tokens` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`      INT UNSIGNED NOT NULL,
  `token`        VARCHAR(255) NOT NULL,
  `platform`     ENUM('ios','android','web') NOT NULL,
  `device_name`  VARCHAR(100) NULL,
  `last_seen_at` DATETIME NULL,
  `created_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pt_token` (`token`),
  KEY `idx_pt_user` (`user_id`),
  CONSTRAINT `fk_pt_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =====================================================================
-- 10. AUDITORÍA
-- =====================================================================

CREATE TABLE `audit_log` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dojo_id`     INT UNSIGNED NULL,
  `user_id`     INT UNSIGNED NULL COMMENT 'quién hizo el cambio',
  `action`      VARCHAR(50) NOT NULL COMMENT 'create, update, delete, promote, refund, login_as…',
  `entity`      VARCHAR(50) NOT NULL COMMENT 'membership, payment, rank, member…',
  `entity_id`   VARCHAR(50) NULL,
  `before_data` JSON NULL,
  `after_data`  JSON NULL,
  `ip_address`  VARCHAR(45) NULL,
  `created_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_al_entity` (`dojo_id`,`entity`,`entity_id`),
  KEY `idx_al_date` (`dojo_id`,`created_at`),
  CONSTRAINT `fk_al_dojo` FOREIGN KEY (`dojo_id`) REFERENCES `dojos` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_al_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- =====================================================================
-- 11. VISTAS DE APOYO (lecturas comunes ya filtrables por dojo_id)
-- =====================================================================

-- Asistencias por alumno y disciplina desde que obtuvo su grado actual
-- (usa la FECHA DE LA CLASE, no la de la reserva).
CREATE OR REPLACE VIEW `v_member_rank_progress` AS
SELECT
  mr.dojo_id,
  mr.user_id,
  mr.discipline_id,
  mr.rank_id            AS current_rank_id,
  mr.stripes,
  mr.since_date,
  mr.next_exam_date,
  r.track_id,
  r.level               AS current_level,
  nr.id                 AS next_rank_id,
  nr.min_months         AS next_min_months,
  nr.min_classes        AS next_min_classes,
  TIMESTAMPDIFF(MONTH, mr.since_date, CURDATE()) AS months_in_rank,
  (SELECT COUNT(*)
     FROM class_bookings cb
     JOIN class_sessions cs ON cs.dojo_id = cb.dojo_id AND cs.id = cb.session_id
    WHERE cb.dojo_id = mr.dojo_id
      AND cb.user_id = mr.user_id
      AND cb.status = 'attended'
      AND cs.discipline_id = mr.discipline_id
      AND cs.session_date >= mr.since_date) AS classes_in_rank
FROM member_ranks mr
JOIN ranks r  ON r.dojo_id = mr.dojo_id AND r.id = mr.rank_id
LEFT JOIN ranks nr
       ON nr.dojo_id = r.dojo_id
      AND nr.track_id = r.track_id
      AND nr.level = (SELECT MIN(r2.level) FROM ranks r2
                       WHERE r2.dojo_id = r.dojo_id AND r2.track_id = r.track_id
                         AND r2.level > r.level AND r2.active = 1);

-- Saldo pendiente por persona
CREATE OR REPLACE VIEW `v_member_balance` AS
SELECT
  c.dojo_id,
  c.user_id,
  c.currency,
  SUM(c.total - c.amount_paid)                                        AS balance_due,
  SUM(CASE WHEN c.due_date < CURDATE() THEN c.total - c.amount_paid ELSE 0 END) AS overdue,
  MIN(CASE WHEN c.total > c.amount_paid THEN c.due_date END)          AS oldest_due_date,
  COUNT(*)                                                            AS open_charges
FROM charges c
WHERE c.status IN ('pending','partial')
GROUP BY c.dojo_id, c.user_id, c.currency;

SET FOREIGN_KEY_CHECKS = 1;
