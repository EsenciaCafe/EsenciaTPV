-- ============================================================
-- seed.sql — Datos de prueba iniciales del TPV
-- Ejecutar DESPUÉS de schema.sql en: Supabase → SQL Editor
-- ============================================================

-- Limpiar antes de insertar (idempotente)
truncate modifier_options, modifiers, menu_items, categories, grid_items restart identity cascade;

-- ─────────────────────────────────────────
-- CATEGORÍAS
-- ─────────────────────────────────────────
insert into categories (id, name, type, parent_id) values
  ('drinks', 'Bebidas',    'category',    null),
  ('coffee', 'Café & té',  'category',    null),
  ('food',   'Alimentos',  'category',    null),
  ('bakery', 'Repostería', 'subcategory', 'food'),
  ('savory', 'Salado',     'subcategory', 'food'),
  ('matcha', 'Matcha',     'subcategory', 'coffee');

-- ─────────────────────────────────────────
-- MODIFICADORES
-- ─────────────────────────────────────────
insert into modifiers (id, name, assigned_items) values
  ('milk-type', 'Tipo de leche', array['con-leche', 'capuccino', 'latte']);

insert into modifier_options (id, modifier_id, name, price) values
  ('opt-standard', 'milk-type', 'Leche Entera',    0.00),
  ('opt-oat',      'milk-type', 'Leche de Avena',  1.00),
  ('opt-soy',      'milk-type', 'Leche de Soja',   0.50);

-- ─────────────────────────────────────────
-- ARTÍCULOS DEL CATÁLOGO
-- ─────────────────────────────────────────
insert into menu_items (id, name, price, category, image, modifiers) values
  -- Café & té
  ('espresso',      'Espresso',          1.50, 'coffee', null,              '{}'),
  ('con-leche',     'Café con Leche',    1.80, 'coffee', null,              array['milk-type']),
  ('capuccino',     'Capuccino',         2.50, 'coffee', null,              array['milk-type']),
  ('latte',         'Latte',             2.50, 'coffee', '/latte.png',      array['milk-type']),
  ('matcha',        'Matcha Latte',      3.20, 'coffee', null,              '{}'),
  -- Repostería
  ('croissant',         'Croissant Classic',    1.80, 'bakery', null, '{}'),
  ('croissant-almond',  'Croissant Almendra',   2.50, 'bakery', null, '{}'),
  ('cheesecake',        'Tarta de Queso',       4.50, 'bakery', null, '{}'),
  ('muffin',            'Muffin Arándanos',     2.20, 'bakery', null, '{}'),
  ('minipancakes',      'MiniPancakes',         3.50, 'bakery', '/minipancakes.png', '{}'),
  -- Salado
  ('tostada-tomate',    'Tostada con Tomate',   2.00, 'savory', null, '{}'),
  ('tostada-aguacate',  'Tostada Aguacate',     4.80, 'savory', null, '{}'),
  ('bikini',            'Bikini Mixto',         3.50, 'savory', null, '{}'),
  -- Bebidas
  ('zumo',   'Zumo Naranja',    3.00, 'drinks', null, '{}'),
  ('cola',   'Refresco Cola',   2.20, 'drinks', null, '{}'),
  ('water',  'Agua Mineral',    1.50, 'drinks', null, '{}'),
  -- Matcha
  ('matcha-frape',  'Matcha Frapé',   3.80, 'matcha', null, '{}'),
  ('matcha-cookie', 'Matcha Cookie',  2.00, 'matcha', null, '{}');

-- ─────────────────────────────────────────
-- GRID DE ATAJOS RÁPIDOS
-- ─────────────────────────────────────────
insert into grid_items (grid_key, slots) values
  ('root', '[
    {"type":"category","target":"drinks","name":"Bebidas","color":"blue"},
    {"type":"category","target":"coffee","name":"Café & té","color":"blue"},
    null,
    {"type":"category","target":"food","name":"Alimentos","color":"blue"},
    {"type":"subcategory","target":"matcha","name":"Matcha","color":"green"},
    null,
    {"type":"article","itemId":"minipancakes","name":"MiniPancakes","price":3.50,"image":"/minipancakes.png"},
    {"type":"article","itemId":"latte","name":"Latte","price":2.50,"image":"/latte.png"},
    null
  ]'::jsonb),
  ('drinks', '[
    {"type":"article","itemId":"zumo","name":"Zumo Naranja","price":3.00},
    {"type":"article","itemId":"cola","name":"Refresco Cola","price":2.20},
    {"type":"article","itemId":"water","name":"Agua Mineral","price":1.50},
    null, null, null, null, null
  ]'::jsonb),
  ('coffee', '[
    {"type":"article","itemId":"espresso","name":"Espresso","price":1.50},
    {"type":"article","itemId":"con-leche","name":"Café con Leche","price":1.80},
    {"type":"article","itemId":"capuccino","name":"Capuccino","price":2.50},
    {"type":"article","itemId":"latte","name":"Latte","price":2.50,"image":"/latte.png"},
    {"type":"article","itemId":"matcha","name":"Matcha Latte","price":3.20},
    null, null, null
  ]'::jsonb),
  ('food', '[
    {"type":"article","itemId":"croissant","name":"Croissant Classic","price":1.80},
    {"type":"article","itemId":"croissant-almond","name":"Croissant Almendra","price":2.50},
    {"type":"article","itemId":"cheesecake","name":"Tarta de Queso","price":4.50},
    {"type":"article","itemId":"muffin","name":"Muffin Arándanos","price":2.20},
    {"type":"article","itemId":"tostada-tomate","name":"Tostada Tomate","price":2.00},
    {"type":"article","itemId":"tostada-aguacate","name":"Tostada Aguacate","price":4.80},
    {"type":"article","itemId":"bikini","name":"Bikini Mixto","price":3.50},
    null
  ]'::jsonb),
  ('matcha', '[
    {"type":"article","itemId":"matcha","name":"Matcha Latte","price":3.20},
    {"type":"article","itemId":"matcha-frape","name":"Matcha Frapé","price":3.80},
    {"type":"article","itemId":"matcha-cookie","name":"Matcha Cookie","price":2.00},
    null, null, null, null, null
  ]'::jsonb);

-- ============================================================
-- Para limpiar al final del desarrollo (mantiene la estructura):
--   truncate modifier_options, modifiers, menu_items, categories, grid_items
--   restart identity cascade;
-- ============================================================
