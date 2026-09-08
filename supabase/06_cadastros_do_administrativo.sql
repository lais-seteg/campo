-- ═══════════════════════════════════════════════════════════════════════
--  06 · CADASTROS SÃO DO ADMINISTRATIVO
--
--  Rode DEPOIS de 05_ajustes_v3.sql.
--
--  A aba Cadastros (hotéis e valor de referência da diária) passou a ser
--  exclusiva do papel `administrativo`. A tela e o middleware já barram —
--  mas tela escondida não é permissão, e aqui está a barreira de verdade.
--
--  ── DUAS COISAS ESTAVAM DESALINHADAS, E EM DIREÇÕES OPOSTAS ──
--
--   1. FROUXO DEMAIS: `hoteis` aceitava INSERT e UPDATE de QUALQUER usuário
--      ativo. Qualquer técnico podia cadastrar e reescrever hotel — e a
--      diária do hotel é o que alimenta o previsto do campo, então isso era
--      mexer em dinheiro sem ser o dono do cadastro.
--   2. APERTADO NO LUGAR ERRADO: excluir hotel e ajustar a diária exigiam
--      `eh_gestor()`. Com a aba indo para o administrativo, ele veria os
--      botões e tomaria 403 do Postgres — o pior dos dois mundos, porque o
--      erro apareceria depois do clique.
--
--  Agora as duas leem a mesma função, e é a mesma que a tela usa.
--
--  ── ATENÇÃO, CONSEQUÊNCIA IMEDIATA ──
--
--  `gestor` e `direcao` PERDEM o cadastro de hotéis e diárias. Se nenhum
--  acesso tiver o papel `administrativo`, NINGUÉM edita esses dois
--  cadastros até que alguém receba o papel. A conferência no fim deste
--  arquivo avisa se esse é o caso.
-- ═══════════════════════════════════════════════════════════════════════


-- ── Quem é o administrativo ──
--
-- Função própria, e não `papel_atual() = 'administrativo'` espalhado nas
-- políticas: quando a regra mudar, muda num lugar. É o mesmo desenho de
-- `eh_direcao()` e `eh_gestor()`.
create or replace function public.eh_administrativo()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(public.papel_atual() = 'administrativo', false)
$$;

comment on function public.eh_administrativo() is
  'Papel administrativo: dono dos cadastros de hotel e do valor de referência da diária. Não inclui gestor nem direcao — foi decisão explícita.';

revoke all    on function public.eh_administrativo() from public, anon;
grant  execute on function public.eh_administrativo() to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
--  HOTÉIS — todo mundo LÊ, só o administrativo ESCREVE
--
--  A leitura fica aberta a usuário ativo de propósito: quem fecha a
--  logística escolhe o hotel numa lista, e quem abre o pedido vê a diária
--  combinada. Esconder a lista quebraria as duas telas sem proteger nada —
--  o cadastro de hotel não é sigiloso, é responsabilidade de um setor.
-- ═══════════════════════════════════════════════════════════════════════
drop policy if exists "hoteis: usuário ativo consulta"  on public.hoteis;
drop policy if exists "hoteis: usuário ativo cadastra"  on public.hoteis;
drop policy if exists "hoteis: usuário ativo edita"     on public.hoteis;
drop policy if exists "hoteis: só Gestão exclui"        on public.hoteis;
drop policy if exists "hoteis: administrativo cadastra" on public.hoteis;
drop policy if exists "hoteis: administrativo edita"    on public.hoteis;
drop policy if exists "hoteis: administrativo exclui"   on public.hoteis;

create policy "hoteis: usuário ativo consulta" on public.hoteis
  for select to authenticated using (public.eh_usuario_ativo());

create policy "hoteis: administrativo cadastra" on public.hoteis
  for insert to authenticated with check (public.eh_administrativo());

create policy "hoteis: administrativo edita" on public.hoteis
  for update to authenticated using (public.eh_administrativo()) with check (public.eh_administrativo());

create policy "hoteis: administrativo exclui" on public.hoteis
  for delete to authenticated using (public.eh_administrativo());

comment on table public.hoteis is
  'Hotéis e pousadas por município, com a diária combinada. Leitura para qualquer usuário ativo (a logística escolhe daqui); escrita só do papel administrativo.';


-- ═══════════════════════════════════════════════════════════════════════
--  VALOR DA DIÁRIA — todo mundo LÊ, só o administrativo AJUSTA
--
--  Continua sendo parâmetro de pagamento, não preferência de tela: o que
--  muda é de quem é a caneta.
-- ═══════════════════════════════════════════════════════════════════════
drop policy if exists "diárias: usuário ativo consulta"    on public.diaria_valores;
drop policy if exists "diárias: só Gestão ajusta"          on public.diaria_valores;
drop policy if exists "diárias: administrativo ajusta"     on public.diaria_valores;

create policy "diárias: usuário ativo consulta" on public.diaria_valores
  for select to authenticated using (public.eh_usuario_ativo());

create policy "diárias: administrativo ajusta" on public.diaria_valores
  for update to authenticated using (public.eh_administrativo()) with check (public.eh_administrativo());

comment on table public.diaria_valores is
  'Valor de referência da diária de alimentação. Leitura para qualquer usuário ativo; ajuste só do papel administrativo.';


-- ═══════════════════════════════════════════════════════════════════════
--  CONFERÊNCIA
-- ═══════════════════════════════════════════════════════════════════════
select
  to_regprocedure('public.eh_administrativo()') is not null as funcao_criada,
  (select count(*) from pg_policies
    where schemaname='public' and tablename='hoteis') as politicas_de_hoteis,
  (select count(*) from pg_policies
    where schemaname='public' and tablename='diaria_valores') as politicas_de_diarias,
  (select count(*) from public.perfis where ativo and papel = 'administrativo')
    as acessos_administrativos,
  case
    when (select count(*) from public.perfis where ativo and papel = 'administrativo') = 0
      then 'ATENCAO: nenhum acesso com papel administrativo. Ninguem edita hotel nem diaria ate alguem receber o papel.'
    else 'ok'
  end as aviso;
