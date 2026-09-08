// Modelo do config.js — mostra quais valores o aplicativo espera.
//
// Os dois estão em Project Settings → API, no painel do Supabase:
//   SUPABASE_URL  → "Project URL"
//   SUPABASE_KEY  → a chave "publishable" (começa com sb_publishable_)
//
// A chave publishable é feita para ficar visível no navegador; a
// segurança vem das regras do banco (ver supabase/README.md). A chave
// secret / service_role ignora todas essas regras e NUNCA pode ser
// colocada aqui nem em qualquer arquivo que vá para o navegador.

window.SUPABASE_URL = "https://SEU-PROJETO.supabase.co";
window.SUPABASE_KEY = "sb_publishable_TROCAR_ESTA_CHAVE";
