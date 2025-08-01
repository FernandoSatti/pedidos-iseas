-- Limpiar usuarios existentes
DELETE FROM public.users;

-- Insertar usuarios con IDs definidos
INSERT INTO public.users (id, name, role) VALUES 
  ('vale-1', 'Vale', 'vale'),
  ('lucho-1', 'Lucho', 'armador'),
  ('franco-1', 'Franco', 'armador'),
  ('negro-1', 'Negro', 'armador');
