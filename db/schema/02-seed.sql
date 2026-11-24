-- =====================================================================
-- BudoDesk — Datos iniciales (se cargan solo al crear la base vacía)
-- Catálogo del dojo Seikoukan tomado del fsms.sql anterior.
-- No incluye usuarios: el superadmin se crea con un script del backend
-- (para no guardar contraseñas ni hashes en el repo).
-- =====================================================================
USE `budodesk`;
SET NAMES utf8mb4;

INSERT INTO dojos (id, slug, name, short_name, logo_url, email, website, country_code, currency, timezone, language, status, plan)
VALUES (1, 'seikoukan', 'Tendoryu Aikido - Seikoukan', 'Seikoukan', NULL,
        'info@tendoryu-aikido.mx', 'https://tendoryu-aikido.mx', 'MX', 'MXN', 'America/Mexico_City', 'es', 'active', 'pro');

INSERT INTO dojo_payment_settings (dojo_id, paypal_enabled, accepts_cash, accepts_transfer)
VALUES (1, 0, 1, 1);

INSERT INTO dojo_locations (id, dojo_id, name) VALUES (1, 1, 'Dojo principal');

INSERT INTO disciplines (id, dojo_id, name, style, sort_order) VALUES
  (1, 1, 'Aikido',    'Tendoryu', 1),
  (2, 1, 'Karate Do', NULL,       2);

-- Aikido se muestra por grado (kyu/dan); Karate por color de cinta
INSERT INTO rank_tracks (id, dojo_id, discipline_id, name, display_style, sort_order) VALUES
  (1, 1, 1, 'General', 'rank', 1),
  (2, 1, 2, 'General', 'belt', 1);

-- Aikido (min_months / min_classes = requisito para OBTENER ese grado)
INSERT INTO ranks (dojo_id, discipline_id, track_id, name, level, kind, color, min_months, min_classes) VALUES
  (1,1,1,'10mo Kyu', 1,'kyu','#FFFFFF',NULL,NULL),
  (1,1,1,'9no Kyu',  2,'kyu','#FFFFFF',NULL,NULL),
  (1,1,1,'8vo Kyu',  3,'kyu','#FFFFFF',NULL,NULL),
  (1,1,1,'7mo Kyu',  4,'kyu','#FFFFFF',NULL,NULL),
  (1,1,1,'6to Kyu',  5,'kyu','#FFFFFF',3,30),
  (1,1,1,'5to Kyu',  6,'kyu','#FFFFFF',3,30),
  (1,1,1,'4to Kyu',  7,'kyu','#FFFFFF',7,40),
  (1,1,1,'3er Kyu',  8,'kyu','#FFFFFF',4,40),
  (1,1,1,'2do Kyu',  9,'kyu','#FFFFFF',6,50),
  (1,1,1,'1er Kyu', 10,'kyu','#FFFFFF',6,50),
  (1,1,1,'1er Dan', 11,'dan','#000000',12,100),
  (1,1,1,'2do Dan', 12,'dan','#000000',NULL,NULL),
  (1,1,1,'3er Dan', 13,'dan','#000000',NULL,NULL),
  (1,1,1,'4to Dan', 14,'dan','#000000',NULL,NULL),
  (1,1,1,'5to Dan', 15,'dan','#000000',NULL,NULL);

-- Karate Do
INSERT INTO ranks (dojo_id, discipline_id, track_id, name, level, kind, color, min_months, min_classes) VALUES
  (1,2,2,'7mo Kyu', 1,'kyu','#FFFFFF',NULL,NULL),
  (1,2,2,'6to Kyu', 2,'kyu','#FCD34D',3,30),
  (1,2,2,'5to Kyu', 3,'kyu','#FB923C',3,30),
  (1,2,2,'4to Kyu', 4,'kyu','#10B981',4,40),
  (1,2,2,'3er Kyu', 5,'kyu','#3B82F6',4,40),
  (1,2,2,'2do Kyu', 6,'kyu','#8B5CF6',6,50),
  (1,2,2,'1er Kyu', 7,'kyu','#7C2D12',6,50),
  (1,2,2,'1er Dan', 8,'dan','#000000',12,100);

-- Planes (antes "packages"). max_members del Familiar es una suposición: ajústalo.
INSERT INTO plans (dojo_id, name, billing_type, interval_unit, interval_count, price, currency, max_members, sort_order) VALUES
  (1, 'Individual Mensual',  'recurring', 'month', 1,  750.00, 'MXN', 1, 1),
  (1, 'Familiar',            'recurring', 'month', 1, 1200.00, 'MXN', 4, 2);

-- "Individual Familiar" ($600) ahora es Individual Mensual + este descuento (750 - 20% = 600)
INSERT INTO discounts (dojo_id, name, type, value, description) VALUES
  (1, 'Familiar', 'percent', 20.00, 'Miembro de familia con cobro individual');
