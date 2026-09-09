-- ═══════════════════════════════════════════════════════════════════════
--  13 · O CATÁLOGO PELO CAMPO, E QUEM DORME NO HOTEL
--
--  Rode depois de 12_liberacao_da_folga.sql.
--
--  ── 1. O BUG: A LISTA DE EQUIPAMENTOS VINHA VAZIA ──
--
--  `itens` é do Controle de Estoque, e a política de SELECT dela exige
--  `eh_usuario_estoque()` — ou seja, `perfis.acesso_estoque = true`. Isso
--  faz todo sentido LÁ: é a flag que diz quem usa aquele sistema.
--
--  Só que o campo lia a tabela DIRETO (`lerCatalogo` em lib/dados.ts), e
--  então herdava essa exigência sem querer. Resultado: dos 33 acessos
--  ativos, apenas 4 tinham `acesso_estoque` — e para os outros 29, entre
--  eles OS DOIS DA DIREÇÃO e os 25 solicitantes, o campo "Equipamento
--  requisitado" simplesmente não tinha o que mostrar. Nenhum erro na tela:
--  a RLS não recusa a consulta, ela devolve zero linha.
--
--  O curioso é que metade do sistema já fazia certo:
--  `itens_disponiveis_no_periodo()` é `security definer` e pergunta
--  `eh_usuario_ativo()`. Quem pede material para campo precisa ver o
--  catálogo — isso já estava decidido ali. `lerCatalogo` era a peça
--  inconsistente.
--
--  A correção NÃO é dar `acesso_estoque` a todo mundo: isso os colocaria
--  dentro do Controle de Estoque, que é outro sistema e outra decisão. É
--  dar ao campo a própria porta, que entrega só as seis colunas de que ele
--  precisa.
--
--  ── 2. QUEM DORME ONDE ──
--
--  `solicitacao_hospedagens` tinha cidade, entrada, saída, hotel e diária —
--  e não tinha PESSOA. Com a equipe dividida em duas bases, o hotel recebia
--  uma reserva sem saber para quem, e a conta do fim do mês não fechava com
--  ninguém em particular.
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
--  A PORTA DO CAMPO PARA O CATÁLOGO
--
--  `security definer` para não depender de `acesso_estoque`, e
--  `eh_usuario_ativo()` porque é essa a regra do campo: quem está dentro do
--  sistema pode pedir equipamento, logo precisa ver o que existe.
--
--  Somente LEITURA, e somente as colunas que o formulário usa. Preço,
--  fornecedor, nota fiscal e o resto do cadastro do estoque continuam onde
--  estavam — este sistema não tem nada a ver com eles.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.catalogo_de_campo()
returns table(
  id uuid,
  codigo text,
  produto text,
  categoria text,
  estoque_atual integer,
  em_manutencao boolean
)
language sql stable security definer set search_path to ''
as $function$
  select i.id, i.codigo, i.produto, i.categoria, i.estoque_atual, i.em_manutencao
    from public.itens i
   where public.eh_usuario_ativo()
   order by i.produto
$function$;

comment on function public.catalogo_de_campo() is
  'O catálogo de itens visto pelo sistema de campo. security definer de propósito: `itens` exige acesso_estoque, que é a flag de QUEM USA O ESTOQUE — e pedir equipamento para campo não exige usar o estoque. Só leitura, só as colunas do formulário.';

revoke all    on function public.catalogo_de_campo() from public, anon;
grant  execute on function public.catalogo_de_campo() to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
--  A PESSOA HOSPEDADA
--
--  Texto e não FK para `solicitacao_equipe`: uma linha de hospedagem é por
--  CIDADE, e nela pode dormir mais de uma pessoa — "Ana e Bruno", "equipe
--  toda". Uma FK obrigaria uma tabela de ligação para dizer o que uma
--  frase resolve, e o hotel recebe nome, não id. O formulário oferece a
--  equipe já digitada como sugestão, para o nome sair igual nos dois
--  lugares.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.solicitacao_hospedagens
  add column if not exists hospedes text;

comment on column public.solicitacao_hospedagens.hospedes is
  'Quem dorme nesta cidade. Livre porque uma linha por cidade pode abrigar várias pessoas; o formulário sugere os nomes da equipe.';


-- ═══════════════════════════════════════════════════════════════════════
--  CONFERÊNCIA
-- ═══════════════════════════════════════════════════════════════════════
select (select count(*) from public.catalogo_de_campo()) as itens_visiveis_pelo_campo,
       exists (select 1 from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'solicitacao_hospedagens'
                  and column_name = 'hospedes') as coluna_hospedes_criada;
