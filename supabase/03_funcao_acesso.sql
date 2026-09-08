-- ═══════════════════════════════════════════════════════════════════════
--  SOLICITAÇÃO DE CAMPO · Seteg — Função de criação de acesso
--
--  Rode DEPOIS de 02_campo_v2.sql e ANTES de 03_acessos.sql.
--  Não contém senha nenhuma — pode ser versionado no Git.
--
--  É a mesma função de ESTOQUE/supabase/02_funcao_acesso.sql, com duas
--  diferenças, e o mesmo e-mail interno (@estoque.setegce.com) porque os
--  dois sistemas compartilham `auth.users` e `perfis`: mudar o domínio
--  aqui criaria um segundo login para a mesma pessoa em vez de atualizar
--  o que existe.
--
--   1. aceita o papel `direcao`, que não existia quando ela foi escrita;
--   2. grava o `cargo` (o rótulo que aparece embaixo do nome na tela).
--
--  No sistema, a pessoa digita SÓ a senha — é ela que identifica quem
--  está entrando (ver identificar_acesso). O `usuario` e o e-mail
--  montados aqui são identificadores internos, que ninguém digita.
--
--  Por isso duas pessoas não podem ter a mesma senha: o sistema não teria
--  como saber quem é quem. Esta função recusa a repetição.
-- ═══════════════════════════════════════════════════════════════════════

-- SECURITY DEFINER e capaz de criar Direção: por isso nasce sem permissão
-- de execução para qualquer papel da API (o REVOKE no fim), e 03_acessos.sql
-- a destrói assim que os acessos são criados.
create or replace function public.criar_acesso(
  p_usuario        text,
  p_nome           text,
  p_senha          text,
  p_papel          text,
  p_cargo          text    default null,
  p_pode_relatorio boolean default false
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_usuario)) || '@estoque.setegce.com';
  v_id    uuid;
  v_dono  text;
begin
  if length(p_senha) < 8 then
    raise exception 'A senha de "%" tem menos de 8 caracteres.', p_usuario;
  end if;
  -- Cinco papéis desde 05_ajustes_v3.sql: `administrativo` e `financeiro`
  -- entraram para que alguém fora da Direção possa ver valor consolidado.
  if p_papel not in ('direcao', 'gestor', 'administrativo', 'financeiro', 'tecnico') then
    raise exception 'Papel inválido para "%": %. Use direcao, gestor, administrativo, financeiro ou tecnico.',
      p_usuario, p_papel;
  end if;

  select id into v_id from auth.users where email = v_email;

  -- Como o login tem um campo só, é a senha que identifica a pessoa:
  -- duas pessoas com a mesma senha deixariam o sistema sem saber quem
  -- está entrando. Aqui isso é barrado antes de acontecer.
  select u.email into v_dono
    from auth.users u
   where u.encrypted_password is not null
     and (v_id is null or u.id <> v_id)
     and u.encrypted_password = extensions.crypt(p_senha, u.encrypted_password)
   limit 1;

  if v_dono is not null then
    raise exception 'A senha escolhida para "%" já pertence a outro acesso (%). Cada pessoa precisa de uma senha diferente.',
      p_usuario, split_part(v_dono, '@', 1);
  end if;

  if v_id is null then
    v_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_id, 'authenticated', 'authenticated', v_email,
      extensions.crypt(p_senha, extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('nome', p_nome, 'usuario', lower(btrim(p_usuario))),
      '', '', '', ''
    );

    -- Sem a linha em auth.identities o login por senha não funciona.
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_id, v_id::text,
      jsonb_build_object(
        'sub', v_id::text, 'email', v_email,
        'email_verified', true, 'phone_verified', false
      ),
      'email', now(), now(), now()
    );
  else
    -- Já existia: só redefine a senha e os dados.
    update auth.users
       set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')),
           raw_user_meta_data  = jsonb_build_object('nome', p_nome, 'usuario', lower(btrim(p_usuario))),
           email_confirmed_at  = coalesce(email_confirmed_at, now()),
           updated_at          = now()
     where id = v_id;
  end if;

  insert into public.perfis (id, usuario, nome, papel, cargo, ativo, pode_relatorio)
  values (v_id, lower(btrim(p_usuario)), p_nome, p_papel, p_cargo, true,
          coalesce(p_pode_relatorio, false))
  on conflict (id) do update
    set usuario        = excluded.usuario,
        nome           = excluded.nome,
        papel          = excluded.papel,
        cargo          = coalesce(excluded.cargo, public.perfis.cargo),
        ativo          = true,
        pode_relatorio = excluded.pode_relatorio;

  return v_id;
end;
$$;

-- Ninguém acessível pela API pode chamar esta função.
revoke execute on function public.criar_acesso(text, text, text, text, text, boolean)
  from public, anon, authenticated;
