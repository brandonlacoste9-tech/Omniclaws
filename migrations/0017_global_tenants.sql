-- Global tenant deployment: regional pricing, currency, language

ALTER TABLE tenant_configs ADD COLUMN currency TEXT DEFAULT 'USD';
ALTER TABLE tenant_configs ADD COLUMN language TEXT DEFAULT 'en';
ALTER TABLE tenant_configs ADD COLUMN region TEXT DEFAULT 'americas';

INSERT OR IGNORE INTO tenant_configs (id, subdomain, name, headline, subhead, pricing_multiplier, currency, language, allowed_features, region) VALUES
-- NORTH AMERICA
('omniclaws-us', 'omniclaws.us', 'Omniclaws USA', 'The 24/7 Revenue Claw', '50 free tasks daily. ETH + BTC whale alerts.', 1.0, 'USD', 'en', 'openclaw,whale,referral', 'americas'),
('omniclaws-mx', 'omniclaws.mx', 'Omniclaws México', 'Automatización sin costos de API', '50 tareas gratis al día.', 0.7, 'MXN', 'es', 'openclaw,whale', 'americas'),
('omniclaws-ca', 'omniclaws.ca', 'Omniclaws Canada', 'The 24/7 Revenue Claw', '50 free tasks daily.', 1.0, 'CAD', 'en', 'openclaw,whale,referral', 'americas'),
-- SOUTH AMERICA
('omniclaws-br', 'omniclaws.com.br', 'Omniclaws Brasil', 'Pix aceito. Automação local.', '50 tarefas grátis por dia.', 0.7, 'BRL', 'pt', 'openclaw,whale', 'americas'),
('omniclaws-ar', 'omniclaws.ar', 'Omniclaws Argentina', 'Automatización 24/7', '50 tareas gratis diarias.', 0.5, 'USD', 'es', 'openclaw', 'americas'),
-- EUROPE (GDPR Compliant)
('omniclaws-fr', 'omniclaws.fr', 'Omniclaws France', 'Automatisation conforme RGPD', '50 tâches gratuites par jour.', 1.0, 'EUR', 'fr', 'openclaw,whale,referral', 'europe'),
('omniclaws-de', 'omniclaws.de', 'Omniclaws Deutschland', 'DSGVO-konforme Automatisierung', '50 kostenlose Aufgaben pro Tag.', 1.0, 'EUR', 'de', 'openclaw,whale,referral', 'europe'),
('omniclaws-uk', 'omniclaws.co.uk', 'Omniclaws UK', 'The 24/7 Revenue Claw', '50 free tasks daily.', 1.1, 'GBP', 'en', 'openclaw,whale,referral', 'europe'),
('omniclaws-eu', 'omniclaws.eu', 'Omniclaws Europe', 'GDPR-compliant automation', '50 free tasks daily.', 1.0, 'EUR', 'en', 'openclaw,whale,referral', 'europe'),
-- ASIA PACIFIC
('omniclaws-in', 'omniclaws.in', 'Omniclaws India', '₹40 per task. Cheaper than chai.', '50 free tasks daily.', 0.4, 'INR', 'en', 'openclaw,whale', 'asia'),
('omniclaws-sg', 'omniclaws.sg', 'Omniclaws Singapore', 'The 24/7 Revenue Claw', '50 free tasks daily.', 1.2, 'SGD', 'en', 'openclaw,whale,referral', 'asia'),
('omniclaws-jp', 'omniclaws.jp', 'Omniclaws Japan', '24時間自動化プラットフォーム', '1日50タスク無料。', 1.1, 'JPY', 'ja', 'openclaw,whale', 'asia'),
-- MIDDLE EAST/AFRICA
('omniclaws-ng', 'omniclaws.ng', 'Omniclaws Nigeria', 'Automation for Africa', '50 free tasks daily.', 0.5, 'NGN', 'en', 'openclaw,whale', 'africa'),
('omniclaws-za', 'omniclaws.co.za', 'Omniclaws South Africa', 'The 24/7 Revenue Claw', '50 free tasks daily.', 0.7, 'ZAR', 'en', 'openclaw,whale', 'africa');
