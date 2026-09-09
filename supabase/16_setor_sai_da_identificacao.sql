-- ═══════════════════════════════════════════════════════════════════════
--  16 · O SETOR SAI DA IDENTIFICAÇÃO
--
--  Rode depois de 15_escopo_da_solicitacao.sql.
--
--  ── POR QUE A COLUNA FICA ──
--
--  O campo saiu do formulário, e é só isso que muda. A coluna CONTINUA, com
--  o que já foi gravado: pedido antigo registra o setor que foi informado
--  quando ele foi aberto, e apagar isso seria perder registro para arrumar
--  uma tela.
--
--  O que muda é a obrigatoriedade. Ela era `not null` sem default: sem essa
--  mudança, tirar o campo da tela faria todo pedido novo bater na restrição
--  e não salvar — o formulário mandaria vazio e o banco recusaria.
--
--  Nenhuma linha existente é tocada: soltar `not null` não reescreve dado,
--  só deixa de exigir daqui para frente.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.solicitacoes
  alter column setor drop not null;

comment on column public.solicitacoes.setor is
  'HERANÇA. O campo saiu do formulário (o solicitante já identifica quem é, e o setor dele não muda a decisão de ninguém). A coluna fica com o que os pedidos antigos gravaram; pedido novo chega nulo.';


-- ═══════════════════════════════════════════════════════════════════════
--  CONFERÊNCIA
-- ═══════════════════════════════════════════════════════════════════════
select count(*) as pedidos,
       count(setor) as com_setor_gravado,
       (select is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = 'solicitacoes'
           and column_name = 'setor') as setor_aceita_nulo
  from public.solicitacoes;
