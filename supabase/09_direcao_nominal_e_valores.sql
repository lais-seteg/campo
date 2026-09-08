-- ═══════════════════════════════════════════════════════════════════════
--  09 · DIREÇÃO NOMINAL E A NOVA REGRA DE QUEM VÊ DINHEIRO
--
--  Rode DEPOIS de 08_organograma.sql.
--
--  Duas mudanças, e elas se apoiam uma na outra.
--
--  ── 1. QUEM VÊ VALOR REAL × PROJETADO ──
--
--  A regra passou a ser: LÍDER DE PROJETO, DIREÇÃO e ADMINISTRATIVO — mais
--  o FINANCEIRO, que continua onde estava.
--
--  Isso inverte a decisão do 07, e a inversão é deliberada. O 07 tirou o
--  `administrativo` da lista com o argumento de que "operar não exige o
--  previsto × real". Na prática da operação não é assim: quem fecha
--  veículo, hotel e material é justamente quem precisa saber se o campo
--  está estourando o previsto — descobrir depois, no fechamento, é tarde
--  para trocar de hotel ou de locadora.
--
--  Sai `gestor`. Não é rebaixamento de ninguém: depois deste arquivo não
--  resta nenhum acesso com esse papel (os dois que havia viraram
--  `administrativo`, ver abaixo). O papel continua existindo no CHECK
--  porque é compartilhado com o Controle de Estoque, mas quem for feito
--  gestor daqui em diante NÃO verá valor — se um dia isso for indesejado,
--  é aqui que se corrige.
--
--  ── 2. A EXCEÇÃO POR PESSOA (`perfis.ve_valores`) ──
--
--  O `administrativo` passa a ver valor, mas UMA pessoa desse papel não
--  pode ver: Jonatas Rodrigues. Como o pedido é sobre a pessoa e não sobre
--  a função, ele não cabe num papel — criar um sexto papel só para abrigar
--  uma exceção transformaria uma decisão de gente numa categoria
--  permanente do sistema.
--
--  Então a exceção fica onde ela é: uma coluna por pessoa, que NEGA. O
--  padrão é `true` (não muda nada para os 33 acessos que já existem), e
--  desligá-la tira o valor de quem quer que seja, inclusive de um líder ou
--  da Direção. É um veto, não uma concessão — e por isso é seguro como
--  padrão ligado.
--
--  ── QUEM FICA COM O QUÊ, DEPOIS DESTE ARQUIVO ──
--
--    ver valor consolidado → direcao, administrativo, financeiro, e o
--                            LÍDER nos projetos que ele lidera
--                            — SEMPRE filtrado por `ve_valores`
--    cadastros (hotel,     → administrativo + direcao
--    valor da diária)        (`eh_gestor()` já inclui a Direção)
--
--  Idempotente: rodar de novo não duplica nem desfaz nada.
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
--  A COLUNA DO VETO
-- ═══════════════════════════════════════════════════════════════════════
alter table public.perfis
  add column if not exists ve_valores boolean not null default true;

comment on column public.perfis.ve_valores is
  'VETO individual sobre valor real × projetado. Padrão true: o papel decide. '
  'Em false, a pessoa não vê valor nenhum mesmo que o papel dela veja — vale '
  'inclusive para líder e Direção. Existe para exceções de pessoa, que não '
  'cabem num papel sem virar categoria permanente.';


-- ═══════════════════════════════════════════════════════════════════════
--  A NOVA REGRA
--
--  A ordem importa: o veto é conferido ANTES do papel. Perfil inexistente
--  ou inativo devolve null, e o `coalesce` transforma em false — negar por
--  omissão é o comportamento certo aqui.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.pode_ver_valores()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select p.ve_valores
       from public.perfis p
      where p.id = (select auth.uid())
        and p.ativo)
    and (
      public.papel_atual() in ('direcao', 'administrativo', 'financeiro')
      or exists (
        select 1 from public.projetos p
         where p.lider_id = (select auth.uid())
      )
    ),
    false)
$$;

comment on function public.pode_ver_valores() is
  'Direção, administrativo, financeiro — ou quem lidera algum projeto —, e '
  'sempre que perfis.ve_valores permitir. Libera valor consolidado (previsto '
  'x real, gasto previsto, custo de avaria). NÃO inclui gestor: a regra passou '
  'a ser líder + Direção + ADM, e não resta acesso com esse papel.';

revoke all    on function public.pode_ver_valores() from public, anon;
grant  execute on function public.pode_ver_valores() to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
--  OS PAPÉIS
--
--  `gestor` deixa de ser usado: os dois acessos que o tinham passam a
--  `administrativo`, que agora vê valor — era isso que o `gestor` dava a
--  eles. Marcelo Holderbaum sobe de `tecnico`.
--
--  ATENÇÃO, EFEITO FORA DAQUI: `eh_gestor()` é compartilhada com o
--  Controle de Estoque, e lá ela libera a EXCLUSÃO de item do catálogo.
--  Juliana e Matheus Haddad perdem isso junto — quem exclui item no
--  estoque passa a ser só a Direção. Se for indesejado, o caminho não é
--  desfazer este update, é dar a eles `acesso_estoque` com o papel que o
--  estoque exige.
--
--  Por `usuario` e não por nome: `usuario` é UNIQUE, e "Juliana Vicente"
--  aparece duas vezes em `perfis` (a segunda, `juliana.colab`, está
--  desativada desde o 07 e tem de continuar assim).
-- ═══════════════════════════════════════════════════════════════════════
update public.perfis
   set papel = 'administrativo'
 where usuario in ('juliana', 'matheus', 'marcelo.holderbaum')
   and papel <> 'administrativo';


-- ═══════════════════════════════════════════════════════════════════════
--  O VETO DO JONATAS
--
--  Ele opera compras e logística — e é para operar que tem o papel. O que
--  não acompanha o papel é o previsto × real, por decisão da Direção.
-- ═══════════════════════════════════════════════════════════════════════
update public.perfis set ve_valores = false where usuario = 'jonatas';


-- ═══════════════════════════════════════════════════════════════════════
--  CONFERÊNCIA
-- ═══════════════════════════════════════════════════════════════════════
select papel,
       count(*) as acessos,
       string_agg(nome || case when ve_valores then '' else ' (SEM VALORES)' end,
                  ', ' order by nome) as quem
  from public.perfis
 where ativo
 group by papel
 order by papel;
