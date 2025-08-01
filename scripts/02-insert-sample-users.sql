-- Limpiar usuarios existentes
DELETE FROM public.users;

-- Insertar usuarios con IDs definidos nuevos
INSERT INTO public.users (id, name, role) VALUES 
  ('riki-1', 'Riki', 'vale'),        -- reemplaza a Vale
  ('camilo-1', 'Camilo', 'armador'),
  ('jesus-1', 'Jesus', 'armador'),
  ('eze-1', 'Eze', 'armador');
  ('chino-1', 'chino', 'armador');
