-- ═══════════════════════════════════════════════════════════════════════
--  15 · O ESCOPO DO CAMPO
--
--  Rode depois de 14_checklist_vivo.sql.
--
--  ── A PERGUNTA QUE NÃO TINHA ONDE SER RESPONDIDA ──
--
--  `projetos.escopo` guarda os PROGRAMAS que o contrato desenvolve —
--  "FAUNA, RUIDO", "Flora, Qualidade do Ar", a lista muda a cada contrato.
--  A solicitação, porém, aponta só para o projeto: dava para saber quanto
--  o CONTRATO custou, nunca quanto a FAUNA custou dentro dele.
--
--  E é essa a conta que a operação faz: um contrato com quatro programas
--  tem quatro equipes, quatro escalas e quatro orçamentos que se
--  consomem em ritmos diferentes. Sem o programa na solicitação, o campo
--  de fauna e o de ruído entram no mesmo bolo.
--
--  ── TEXTO, E NÃO FK ──
--
--  Os programas vivem numa coluna de texto separada por vírgula em
--  `projetos.escopo` — foi assim que os projetos antigos foram gravados, e
--  é isso que a busca da aba e a exportação leem. Criar uma tabela de
--  programas agora obrigaria a migrar aquele texto e a manter as duas
--  versões em acordo. Guardar o programa escolhido como TEXTO na
--  solicitação mantém uma fonte só.
--
--  O preço disso é que renomear um programa no projeto não renomeia nos
--  pedidos antigos — e isso está certo: o pedido registra o programa que
--  existia quando ele foi aberto, como já faz com `cliente_projeto`.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.solicitacoes
  add column if not exists escopo text;

comment on column public.solicitacoes.escopo is
  'O PROGRAMA deste campo, escolhido entre os de projetos.escopo (FAUNA, RUIDO, Flora…). Texto e não FK: os programas vivem numa coluna separada por vírgula no projeto, e o pedido registra o que existia quando foi aberto. É esta coluna que permite somar gasto por programa, e não só por contrato.';

-- Índice porque a pergunta "quanto cada escopo gasta" é um agrupamento por
-- esta coluna, e ela nasce com baixa cardinalidade (meia dúzia de programas
-- por contrato) — exatamente o caso em que o índice ajuda o agrupamento.
create index if not exists solicitacoes_escopo_idx
  on public.solicitacoes (escopo)
  where escopo is not null;


-- ═══════════════════════════════════════════════════════════════════════
--  CONFERÊNCIA
-- ═══════════════════════════════════════════════════════════════════════
select p.cliente, p.nome, p.escopo as programas_do_projeto,
       (select count(*) from public.solicitacoes s where s.projeto_id = p.id) as pedidos,
       (select count(*) from public.solicitacoes s
         where s.projeto_id = p.id and s.escopo is not null) as pedidos_com_programa
  from public.projetos p
 order by p.cliente, p.nome;
