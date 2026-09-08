-- ═══════════════════════════════════════════════════════════════════════
--  10 · DESEMPENHO DA LEITURA
--
--  Rode por ÚLTIMO, depois de 09_direcao_nominal_e_valores.sql.
--
--  ⚠ E RODE DE NOVO se algum dia reaplicar 01_solicitacoes.sql ou
--    02_campo_v2.sql: eles recriam as políticas `... grava` como `FOR ALL`,
--    que é exatamente o que este arquivo desfaz. Não há conflito enquanto a
--    ordem for respeitada — este é o último.
--
--  Nada aqui muda QUEM pode o quê. Os predicados são os mesmos
--  (`eh_usuario_ativo()`, `eh_gestor()`); muda quantas vezes o Postgres os
--  executa.
--
--  ── 1. UMA POLÍTICA DE SELECT POR TABELA, E NÃO DUAS ──
--
--  Sete tabelas tinham DUAS políticas permissivas de SELECT para
--  `authenticated`: uma `FOR SELECT` explícita e uma `FOR ALL` — e `FOR ALL`
--  inclui SELECT. Política permissiva não é atalho: o Postgres avalia TODAS
--  as que se aplicam e faz o OR. Ou seja, cada linha lida chamava
--  `eh_usuario_ativo()` duas vezes, e as duas respondiam o mesmo.
--
--  Seis dessas tabelas são lidas em TODA navegação (o layout carrega os
--  números do menu), então o desperdício era por linha, por tela, para todo
--  mundo.
--
--  A `FOR ALL` vira três políticas explícitas — insert, update e delete.
--  Mesmo predicado, mesmo efeito, e o SELECT passa a ter um dono só.
--
--  ── 2. O PREDICADO É AVALIADO UMA VEZ, NÃO POR LINHA ──
--
--  `eh_usuario_ativo()` é `stable` e não recebe argumento: a resposta é a
--  mesma para todas as linhas da consulta. Chamada direta, ainda assim o
--  planejador a executa por linha. Envolvida em `(select ...)`, ela vira um
--  InitPlan — roda UMA vez e o resultado é reusado.
--
--  É a otimização que a própria Supabase documenta para `auth.uid()`, e
--  vale igual para estas funções, que por dentro leem `perfis` a cada
--  chamada. Numa lista de mil linhas são mil leituras de `perfis` a menos.
--
--  ── 3. UM ÍNDICE, E SÓ UM ──
--
--  `projetos.lider_id`. Não é FK sem índice qualquer: `pode_ver_valores()`
--  faz `exists (select 1 from projetos where lider_id = auth.uid())`, e essa
--  função é chamada pela RLS de tudo que mostra dinheiro.
--
--  Os outros 18 avisos de "FK sem índice" ficaram de fora de propósito: são
--  colunas de auditoria (`criado_por`, `usuario_id`) que ninguém filtra —
--  só pesariam num delete em `auth.users`. Índice que nunca é lido custa
--  escrita e espaço em cada insert, para sempre.
--
--  Também NÃO removi os 15 índices que o advisor chama de "não usados":
--  eles estão sem uso porque o sistema ainda não tem dados (0 solicitações,
--  0 projetos). São os índices de `periodo`, `situacao`, `curso` e `sst`,
--  que existem para as consultas que só vão acontecer quando houver campo
--  cadastrado. Apagá-los seria confundir "sem uso ainda" com "inútil".
--
--  Idempotente: rodar de novo não duplica nem desfaz nada.
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
--  AS SEIS TABELAS-FILHAS DA SOLICITAÇÃO
--
--  Todas com o mesmo desenho, então o mesmo laço serve às seis. Quem lê e
--  quem escreve continua sendo qualquer usuário ativo — a autorização de
--  verdade destas linhas está na solicitação-mãe e nas funções do banco.
-- ═══════════════════════════════════════════════════════════════════════
do $do$
declare
  t text;
  tabelas text[] := array[
    'solicitacao_equipamentos',
    'solicitacao_hospedagens',
    'solicitacao_despesas',
    'solicitacao_diarias',
    'solicitacao_equipe',
    'solicitacao_sst_epis'
  ];
begin
  foreach t in array tabelas loop
    -- A `FOR ALL` que causava o SELECT duplicado.
    execute format('drop policy if exists %I on public.%I', t || ': usuário ativo grava', t);
    -- E as três que a substituem, para o caso de este arquivo já ter rodado.
    execute format('drop policy if exists %I on public.%I', t || ': usuário ativo insere', t);
    execute format('drop policy if exists %I on public.%I', t || ': usuário ativo edita',  t);
    execute format('drop policy if exists %I on public.%I', t || ': usuário ativo exclui', t);

    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check ((select public.eh_usuario_ativo()))',
      t || ': usuário ativo insere', t);

    execute format(
      'create policy %I on public.%I for update to authenticated
         using ((select public.eh_usuario_ativo()))
         with check ((select public.eh_usuario_ativo()))',
      t || ': usuário ativo edita', t);

    execute format(
      'create policy %I on public.%I for delete to authenticated
         using ((select public.eh_usuario_ativo()))',
      t || ': usuário ativo exclui', t);

    -- A de SELECT agora é única: recriada só para ganhar o InitPlan.
    execute format('drop policy if exists %I on public.%I', t || ': usuário ativo consulta', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using ((select public.eh_usuario_ativo()))',
      t || ': usuário ativo consulta', t);
  end loop;
end
$do$;


-- ═══════════════════════════════════════════════════════════════════════
--  `perfis` — A TABELA MAIS LIDA DO SISTEMA
--
--  Toda requisição a lê: é ela que revalida a sessão (lib/sessao.ts), e é
--  ela que `papel_atual()` consulta por dentro de cada função de RLS.
--
--  Ela também é COMPARTILHADA com o Controle de Estoque, então a mudança
--  aqui é a mais conservadora possível: os predicados não mudam, só a
--  `FOR ALL` do gestor é aberta em três comandos.
--
--  Um gestor não perde a leitura ao sair da política de SELECT: `eh_gestor()`
--  chama `papel_atual()`, que só responde para perfil ATIVO — logo, todo
--  gestor já satisfaz `eh_usuario_ativo()`, que é quem passa a responder
--  pelo SELECT dele.
-- ═══════════════════════════════════════════════════════════════════════
drop policy if exists "perfis: só gestor gerencia acessos" on public.perfis;
drop policy if exists "perfis: só gestor cadastra acesso" on public.perfis;
drop policy if exists "perfis: só gestor edita acesso"    on public.perfis;
drop policy if exists "perfis: só gestor exclui acesso"   on public.perfis;

create policy "perfis: só gestor cadastra acesso" on public.perfis
  for insert to authenticated
  with check ((select public.eh_gestor()));

create policy "perfis: só gestor edita acesso" on public.perfis
  for update to authenticated
  using ((select public.eh_gestor()))
  with check ((select public.eh_gestor()));

create policy "perfis: só gestor exclui acesso" on public.perfis
  for delete to authenticated
  using ((select public.eh_gestor()));

drop policy if exists "perfis: usuário ativo consulta" on public.perfis;
create policy "perfis: usuário ativo consulta" on public.perfis
  for select to authenticated
  using ((select public.eh_usuario_ativo()));


-- ═══════════════════════════════════════════════════════════════════════
--  O ÍNDICE DO CAMINHO CRÍTICO
-- ═══════════════════════════════════════════════════════════════════════
create index if not exists projetos_lider_idx on public.projetos (lider_id);

comment on index public.projetos_lider_idx is
  'Serve ao exists() de pode_ver_valores() e de eh_lider(), chamados pela RLS de tudo que mostra dinheiro.';


-- ═══════════════════════════════════════════════════════════════════════
--  CONFERÊNCIA — nenhuma tabela deve aparecer com 2 políticas de SELECT
-- ═══════════════════════════════════════════════════════════════════════
select tablename,
       count(*) filter (where cmd in ('SELECT', 'ALL')) as politicas_de_select
  from pg_policies
 where schemaname = 'public'
   and tablename in ('perfis', 'solicitacao_equipamentos', 'solicitacao_hospedagens',
                     'solicitacao_despesas', 'solicitacao_diarias', 'solicitacao_equipe',
                     'solicitacao_sst_epis')
 group by tablename
 order by politicas_de_select desc, tablename;
