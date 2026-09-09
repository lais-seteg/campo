-- ═══════════════════════════════════════════════════════════════════════
--  17 · O AJUSTE EM CAMPO, E O CHECKLIST QUE NÃO SE PERDE
--
--  Duas coisas que o campo real cobrou do sistema:
--
--  1. O CHECKLIST PRECISA SOBREVIVER AO FECHAR DA JANELA.
--     As marcas do checklist eram encenadas até "Registrar" — de propósito,
--     porque o registro é uma transação só e gravar clique por clique
--     deixaria o estoque a meio caminho se a conexão caísse. Mas o efeito
--     colateral era cruel: quem conferia doze itens, assinava, e fechava o
--     popup antes de registrar, perdia os doze.
--
--     A saída não é gravar as marcas como fato — é gravar o RASCUNHO. O que
--     a pessoa marcou fica num jsonb do pedido, some quando o registro
--     acontece, e não move nada no estoque enquanto está lá. O registro
--     continua sendo o mesmo ato atômico de sempre.
--
--  2. CAMPO EM ANDAMENTO PEDE AJUSTE.
--     Material que faltou, uma diária a mais porque o campo estendeu, um
--     táxi que ninguém previu. Isso já acontecia por EDIÇÃO do pedido, e a
--     edição é o lugar errado: ela APAGA e reescreve as filhas
--     (`limparFilhas`), então um acréscimo feito hoje desaparecia na próxima
--     correção de qualquer outro campo do formulário. Pior: pedido do tipo
--     Administrativo nem envia diárias, então um acréscimo ali era apagado e
--     nunca reescrito.
--
--     Então acréscimo passa a ser ATO PRÓPRIO, como já era para equipamento
--     (`acrescentar_equipamento_solicitacao`, que reserva na mesma transação
--     e registra no histórico). Diária e despesa ganham a mesma forma, e as
--     linhas nascem MARCADAS como acréscimo — é essa marca que faz a edição
--     não as apagar, do mesmo jeito que `entregue = true` já protege o
--     equipamento que saiu para campo.
--
--  Idempotente: pode rodar mais de uma vez.
-- ═══════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
--  1 · O RASCUNHO DO CHECKLIST
-- ─────────────────────────────────────────────────────────────────────
--
-- jsonb e não colunas: o que se guarda é a TELA a meio preenchimento, não
-- um fato do negócio. Fato do negócio tem coluna, restrição e trigger —
-- `entregue`, `teste_entrega`, `avaria` já são isso, e continuam sendo
-- escritos só pelo registro. O rascunho é outra natureza: existe para não
-- se perder, vale por poucas horas, e sua forma é a do formulário — que
-- muda quando o formulário muda, sem migração.
--
-- Nada no banco lê o conteúdo dele. Se o formato mudar, o rascunho velho é
-- descartado pela tela, e o pior que acontece é a pessoa marcar de novo.

alter table public.solicitacoes
  add column if not exists checklist_rascunho jsonb;

comment on column public.solicitacoes.checklist_rascunho is
  'O checklist de conferência a meio preenchimento: o que a pessoa marcou e ainda não registrou. Rascunho de TELA, não fato — quem move o estoque continua sendo registrar_entrega_solicitacao/registrar_devolucao_solicitacao, e é o registro que zera esta coluna. Formato livre, lido só pelo cliente.';


-- ─────────────────────────────────────────────────────────────────────
--  2 · A MARCA DE ACRÉSCIMO NAS FILHAS DE CUSTO
-- ─────────────────────────────────────────────────────────────────────
--
-- `acrescentado_em` não é só auditoria — é PROTEÇÃO. A edição do pedido
-- apaga as diárias e despesas e as reescreve a partir do formulário; com
-- esta coluna preenchida, a linha fica de fora dessa limpeza (ver
-- `app/api/solicitacoes/persistencia.ts`). É o mesmo mecanismo que já
-- guarda o equipamento entregue.
--
-- `acrescentado_por` guarda quem pediu o ajuste. O histórico
-- (`solicitacao_alteracoes`) já grava isso pela trigger de autoria, mas ali
-- a informação é uma LINHA DE TEXTO; aqui ela fica na própria linha de
-- custo, que é o que se lê quando se pergunta "quem mandou pagar isto?".

alter table public.solicitacao_diarias
  add column if not exists acrescentado_em  timestamptz,
  add column if not exists acrescentado_por uuid references auth.users(id) on delete set null;

alter table public.solicitacao_despesas
  add column if not exists acrescentado_em  timestamptz,
  add column if not exists acrescentado_por uuid references auth.users(id) on delete set null;

alter table public.solicitacao_hospedagens
  add column if not exists acrescentado_em  timestamptz,
  add column if not exists acrescentado_por uuid references auth.users(id) on delete set null;

comment on column public.solicitacao_diarias.acrescentado_em is
  'Preenchida quando a linha entrou por AJUSTE EM CAMPO (acrescentar_diaria_solicitacao) e não pelo formulário. Linha marcada não é apagada pela edição do pedido.';
comment on column public.solicitacao_despesas.acrescentado_em is
  'Preenchida quando a linha entrou por AJUSTE EM CAMPO (acrescentar_despesa_solicitacao) e não pelo formulário. Linha marcada não é apagada pela edição do pedido.';
comment on column public.solicitacao_hospedagens.acrescentado_em is
  'Preenchida quando a linha entrou por AJUSTE EM CAMPO (acrescentar_hospedagem_solicitacao) e não pelo formulário. Linha marcada não é apagada pela edição do pedido.';

-- Índice parcial: as consultas que interessam são "quais linhas desta
-- solicitação são acréscimo?" — e acréscimo é a minoria das linhas.
create index if not exists solicitacao_diarias_acrescimo_idx
  on public.solicitacao_diarias (solicitacao_id)
  where acrescentado_em is not null;
create index if not exists solicitacao_despesas_acrescimo_idx
  on public.solicitacao_despesas (solicitacao_id)
  where acrescentado_em is not null;
create index if not exists solicitacao_hospedagens_acrescimo_idx
  on public.solicitacao_hospedagens (solicitacao_id)
  where acrescentado_em is not null;


-- ─────────────────────────────────────────────────────────────────────
--  3 · O ESTADO DO PEDIDO ACEITA ACRÉSCIMO?
-- ─────────────────────────────────────────────────────────────────────
--
-- A mesma pergunta em três funções pede uma função só. Ela levanta a
-- exceção com o código do pedido dentro, porque quem lê o erro está na
-- tela de uma solicitação e precisa saber se é DESTA que se fala.

create or replace function public.exigir_pedido_ajustavel(p_solicitacao uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_status text; v_codigo text;
begin
  if not public.eh_usuario_ativo() then
    raise exception 'Sem permissão.';
  end if;

  select s.status, s.codigo into v_status, v_codigo
    from public.solicitacoes s where s.id = p_solicitacao;
  if not found then
    raise exception 'Solicitação não encontrada.';
  end if;

  -- Finalizada, Cancelada e Recusada são REGISTRO. Acrescentar custo a um
  -- campo que já fechou não é ajuste, é reescrever a história dele — e o
  -- gasto do projeto já foi somado com o número de lá.
  if v_status in ('Finalizada', 'Cancelada', 'Recusada') then
    raise exception 'A solicitação % está % — não aceita acréscimo.', v_codigo, v_status;
  end if;

  return v_codigo;
end;
$$;

comment on function public.exigir_pedido_ajustavel(uuid) is
  'Levanta exceção se o usuário não pode mexer no pedido ou se o pedido já é registro fechado. Devolve o código da solicitação. Usada pelas funções de acréscimo.';

revoke all on function public.exigir_pedido_ajustavel(uuid) from public;
grant execute on function public.exigir_pedido_ajustavel(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────
--  3.1 · DINHEIRO EM TEXTO, PARA A FRASE DO HISTÓRICO
-- ─────────────────────────────────────────────────────────────────────
--
-- `to_char(v, 'FM999G999G990D00')` era o caminho óbvio e estava errado: `G`
-- e `D` são LOCALE-AWARE, e este banco roda com `lc_numeric = en_US.UTF-8`.
-- O histórico saía com "180.50" e "1,500.50" — número americano numa frase
-- em português, e ambíguo justamente onde não pode ser: valor.
--
-- `,` e `.` no molde, ao contrário, são literais fixos. O `translate` troca
-- os dois de posição de uma vez, e o resultado não depende de configuração
-- de servidor nenhuma.

create or replace function public.dinheiro_em_texto(p_valor numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(to_char(coalesce(p_valor, 0), 'FM999,999,999,990.00'), ',.', '.,');
$$;

comment on function public.dinheiro_em_texto(numeric) is
  'Formata valor em pt-BR (1.500,50) sem depender de lc_numeric. Usada nas frases do histórico.';

revoke all on function public.dinheiro_em_texto(numeric) from public;
grant execute on function public.dinheiro_em_texto(numeric) to authenticated;


-- ─────────────────────────────────────────────────────────────────────
--  4 · ACRESCENTAR DIÁRIA
-- ─────────────────────────────────────────────────────────────────────
--
-- O valor unitário vem de FORA e não da tabela de referência de propósito:
-- `diaria_valores` é o valor de HOJE, e uma diária lançada guarda o valor
-- com que foi lançada (é o que a tela de cadastro promete). Quem chama
-- manda o valor que combinou; a tela oferece a referência como sugestão.

create or replace function public.acrescentar_diaria_solicitacao(
  p_solicitacao     uuid,
  p_colaborador     text,
  p_vinculo         text,
  p_tipo_diaria     text,
  p_dias            integer,
  p_valor_unitario  numeric,
  p_dados_bancarios text default null,
  p_motivo          text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid; v_colaborador text; v_tipo text;
begin
  perform public.exigir_pedido_ajustavel(p_solicitacao);

  v_colaborador := nullif(btrim(coalesce(p_colaborador, '')), '');
  if v_colaborador is null then
    raise exception 'Informe o colaborador da diária.';
  end if;
  if coalesce(p_dias, 0) <= 0 then
    raise exception 'A diária acrescentada precisa ter pelo menos um dia.';
  end if;
  if coalesce(p_valor_unitario, 0) <= 0 then
    raise exception 'Informe o valor da diária.';
  end if;

  v_tipo := nullif(btrim(coalesce(p_tipo_diaria, '')), '');
  if v_tipo is null then
    raise exception 'Informe o tipo da diária.';
  end if;

  insert into public.solicitacao_diarias
    (solicitacao_id, colaborador, vinculo, tipo_diaria, dias, valor_unitario,
     dados_bancarios, acrescentado_em, acrescentado_por)
  values
    (p_solicitacao, upper(v_colaborador), p_vinculo, v_tipo, p_dias, p_valor_unitario,
     nullif(btrim(coalesce(p_dados_bancarios, '')), ''), now(), (select auth.uid()))
  returning id into v_id;

  -- O histórico guarda o QUE e o QUANTO numa frase só, porque é assim que
  -- ele é lido: uma linha por acontecimento, na ordem em que aconteceu. O
  -- motivo entra junto quando existe — "por que" é a parte que o número
  -- não conta.
  insert into public.solicitacao_alteracoes (solicitacao_id, tipo, campo, de, para)
  values (p_solicitacao, 'Acréscimo', 'Diária', null,
          format('%s × %s dia(s) de %s a R$ %s%s',
                 upper(v_colaborador), p_dias, v_tipo,
                 public.dinheiro_em_texto(p_valor_unitario),
                 coalesce(' · ' || nullif(btrim(coalesce(p_motivo, '')), ''), '')));

  return v_id;
end;
$$;

comment on function public.acrescentar_diaria_solicitacao(uuid,text,text,text,integer,numeric,text,text) is
  'Acrescenta uma diária a um pedido em andamento, marcada como acréscimo (não é apagada pela edição) e registrada no histórico.';

revoke all on function public.acrescentar_diaria_solicitacao(uuid,text,text,text,integer,numeric,text,text) from public;
grant execute on function public.acrescentar_diaria_solicitacao(uuid,text,text,text,integer,numeric,text,text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────
--  5 · ACRESCENTAR DESPESA
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.acrescentar_despesa_solicitacao(
  p_solicitacao uuid,
  p_grupo       text,
  p_descricao   text,
  p_valor       numeric,
  p_motivo      text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid; v_descricao text;
begin
  perform public.exigir_pedido_ajustavel(p_solicitacao);

  if coalesce(p_valor, 0) <= 0 then
    raise exception 'Informe o valor da despesa.';
  end if;

  -- Despesa sem descrição é um número solto na prestação de contas: seis
  -- meses depois ninguém sabe o que foi, e é justamente aí que se pergunta.
  v_descricao := nullif(btrim(coalesce(p_descricao, '')), '');
  if v_descricao is null then
    raise exception 'Descreva a despesa acrescentada.';
  end if;

  insert into public.solicitacao_despesas
    (solicitacao_id, grupo, descricao, valor, acrescentado_em, acrescentado_por)
  values
    (p_solicitacao, p_grupo, v_descricao, p_valor, now(), (select auth.uid()))
  returning id into v_id;

  insert into public.solicitacao_alteracoes (solicitacao_id, tipo, campo, de, para)
  values (p_solicitacao, 'Acréscimo', 'Despesa', null,
          format('%s · %s · R$ %s%s',
                 p_grupo, v_descricao,
                 public.dinheiro_em_texto(p_valor),
                 coalesce(' · ' || nullif(btrim(coalesce(p_motivo, '')), ''), '')));

  return v_id;
end;
$$;

comment on function public.acrescentar_despesa_solicitacao(uuid,text,text,numeric,text) is
  'Acrescenta uma despesa a um pedido em andamento, marcada como acréscimo (não é apagada pela edição) e registrada no histórico.';

revoke all on function public.acrescentar_despesa_solicitacao(uuid,text,text,numeric,text) from public;
grant execute on function public.acrescentar_despesa_solicitacao(uuid,text,text,numeric,text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────
--  5.1 · ACRESCENTAR HOSPEDAGEM
-- ─────────────────────────────────────────────────────────────────────
--
-- Campo que estende dorme uma noite a mais, e campo que muda de base dorme
-- em outra cidade. Era o acréscimo que faltava — e o mais caro dos quatro
-- para deixar de fora, porque hospedagem não lançada é reserva que ninguém
-- pagou e hotel que cobra depois.
--
-- SEM DATAS, HERDA O PERÍODO DO CAMPO. É o caso normal (dorme-se lá
-- enquanto o campo dura) e é o que evita a linha nascer em branco — o mesmo
-- defeito que a folha do checklist denunciava com "(? a ?, 0d)" e que a
-- seção 7 corrigiu no passado.

create or replace function public.acrescentar_hospedagem_solicitacao(
  p_solicitacao uuid,
  p_cidade      text,
  p_hospedes    text default null,
  p_hotel       uuid default null,
  p_entrada     date default null,
  p_saida       date default null,
  p_diaria      numeric default 0,
  p_motivo      text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_cidade text;
  v_entrada date;
  v_saida date;
  v_dias integer;
  v_hotel text;
begin
  perform public.exigir_pedido_ajustavel(p_solicitacao);

  v_cidade := nullif(btrim(coalesce(p_cidade, '')), '');
  if v_cidade is null then
    raise exception 'Informe a cidade da hospedagem.';
  end if;

  select coalesce(p_entrada, s.periodo_inicio), coalesce(p_saida, s.periodo_fim)
    into v_entrada, v_saida
    from public.solicitacoes s where s.id = p_solicitacao;

  if v_entrada is not null and v_saida is not null and v_saida < v_entrada then
    raise exception 'A saída da hospedagem não pode ser antes da entrada.';
  end if;

  -- Diárias são NOITES: entrar e sair no mesmo dia é zero diária. É a conta
  -- que o hotel faz, e é a mesma de `noitesDaLinha` no formulário.
  v_dias := case
    when v_entrada is null or v_saida is null then 0
    else greatest((v_saida - v_entrada), 0)
  end;

  insert into public.solicitacao_hospedagens
    (solicitacao_id, cidade, hospedes, hotel_id, entrada, saida, dias,
     diaria_prevista, acrescentado_em, acrescentado_por)
  values
    (p_solicitacao, upper(v_cidade), nullif(btrim(coalesce(p_hospedes, '')), ''),
     p_hotel, v_entrada, v_saida, v_dias,
     coalesce(p_diaria, 0), now(), (select auth.uid()))
  returning id into v_id;

  if p_hotel is not null then
    select h.nome into v_hotel from public.hoteis h where h.id = p_hotel;
  end if;

  insert into public.solicitacao_alteracoes (solicitacao_id, tipo, campo, de, para)
  values (p_solicitacao, 'Acréscimo', 'Hospedagem', null,
          format('%s%s · %s%s · R$ %s/dia%s',
                 upper(v_cidade),
                 coalesce(' (' || v_hotel || ')', ''),
                 case
                   when v_entrada is null or v_saida is null then 'datas a definir'
                   else to_char(v_entrada, 'DD/MM/YYYY') || ' a ' || to_char(v_saida, 'DD/MM/YYYY')
                 end,
                 case when v_dias > 0 then format(', %s diária(s)', v_dias) else '' end,
                 public.dinheiro_em_texto(coalesce(p_diaria, 0)),
                 coalesce(' · ' || nullif(btrim(coalesce(p_hospedes, '')), ''), '')
                 || coalesce(' · ' || nullif(btrim(coalesce(p_motivo, '')), ''), '')));

  return v_id;
end;
$$;

comment on function public.acrescentar_hospedagem_solicitacao(uuid,text,text,uuid,date,date,numeric,text) is
  'Acrescenta uma hospedagem a um pedido em andamento, marcada como acréscimo (não é apagada pela edição) e registrada no histórico. Sem datas, herda o período do campo.';

revoke all on function public.acrescentar_hospedagem_solicitacao(uuid,text,text,uuid,date,date,numeric,text) from public;
grant execute on function public.acrescentar_hospedagem_solicitacao(uuid,text,text,uuid,date,date,numeric,text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────
--  6 · O MOTIVO TAMBÉM NO ACRÉSCIMO DE EQUIPAMENTO
-- ─────────────────────────────────────────────────────────────────────
--
-- A função de equipamento já existia e já registrava no histórico. O que
-- ela não tinha era o MOTIVO — e agora que os três acréscimos saem da mesma
-- tela, ficaria estranho o material ser o único sem explicação.
--
-- Assinatura NOVA (com `p_motivo`), e a antiga continua de pé: `default`
-- em todos os parâmetros novos faria as duas ambíguas para o PostgREST, e
-- derrubar a antiga quebraria um deploy anterior ainda no ar durante a
-- troca. A antiga passa a delegar.

create or replace function public.acrescentar_equipamento_solicitacao(
  p_solicitacao uuid,
  p_item        uuid,
  p_quantidade  integer,
  p_descricao   text,
  p_motivo      text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid; v_nome text;
begin
  perform public.exigir_pedido_ajustavel(p_solicitacao);

  if coalesce(p_quantidade, 0) <= 0 then
    raise exception 'A quantidade do acréscimo precisa ser maior que zero.';
  end if;

  insert into public.solicitacao_equipamentos (solicitacao_id, item_id, descricao, quantidade)
  values (p_solicitacao, p_item, nullif(btrim(coalesce(p_descricao, '')), ''), p_quantidade)
  returning id into v_id;

  -- A reserva é refeita na MESMA transação: material novo disputa as datas
  -- como qualquer outro, e se não couber nada disto é gravado.
  if p_item is not null then
    perform public.reservar_equipamentos_solicitacao(p_solicitacao);
    select i.produto || ' · ' || i.codigo into v_nome from public.itens i where i.id = p_item;
  end if;

  insert into public.solicitacao_alteracoes (solicitacao_id, tipo, campo, de, para)
  values (p_solicitacao, 'Acréscimo', 'Equipamento', null,
          format('%s × %s%s', p_quantidade,
                 coalesce(v_nome, nullif(btrim(coalesce(p_descricao, '')), ''), 'item sem catálogo'),
                 coalesce(' · ' || nullif(btrim(coalesce(p_motivo, '')), ''), '')));

  return v_id;
end;
$$;

comment on function public.acrescentar_equipamento_solicitacao(uuid,uuid,integer,text,text) is
  'Acrescenta equipamento a um pedido em andamento, reservando nas datas do campo na mesma transação, com o motivo no histórico.';

revoke all on function public.acrescentar_equipamento_solicitacao(uuid,uuid,integer,text,text) from public;
grant execute on function public.acrescentar_equipamento_solicitacao(uuid,uuid,integer,text,text) to authenticated;

-- A de quatro parâmetros vira um atalho para a de cinco. Assim não há duas
-- cópias da regra livres para divergir.
create or replace function public.acrescentar_equipamento_solicitacao(
  p_solicitacao uuid,
  p_item        uuid,
  p_quantidade  integer,
  p_descricao   text default null
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.acrescentar_equipamento_solicitacao(
    p_solicitacao, p_item, p_quantidade, p_descricao, null::text);
$$;

revoke all on function public.acrescentar_equipamento_solicitacao(uuid,uuid,integer,text) from public;
grant execute on function public.acrescentar_equipamento_solicitacao(uuid,uuid,integer,text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────
--  7 · A HOSPEDAGEM SEM DATA PASSA A NASCER COM AS DATAS DO CAMPO
-- ─────────────────────────────────────────────────────────────────────
--
-- `entrada` e `saida` são opcionais e ficaram nulas nos pedidos já
-- gravados, e a folha do checklist saía com "FORTALEZA (? a ?, 0d)" — que
-- não serve para conferir reserva em balcão de hotel.
--
-- O certo para os pedidos NOVOS é a tela sugerir o período do campo (é o
-- que ela passa a fazer). Para os que já existem, a correção é aqui: quem
-- não tem data herda o período da própria solicitação, que é a única
-- informação verdadeira disponível — a pessoa dorme lá durante o campo.
--
-- `dias` é recontado junto: era 0 pela mesma razão.

update public.solicitacao_hospedagens h
   set entrada = s.periodo_inicio,
       saida   = s.periodo_fim,
       dias    = greatest((s.periodo_fim - s.periodo_inicio), 0)
  from public.solicitacoes s
 where s.id = h.solicitacao_id
   and h.entrada is null
   and h.saida is null
   and s.periodo_inicio is not null
   and s.periodo_fim is not null;

-- Linha com as duas datas mas `dias` zerado ou nulo: recontar não inventa
-- nada, só refaz a subtração que ficou faltando.
update public.solicitacao_hospedagens
   set dias = greatest((saida - entrada), 0)
 where entrada is not null
   and saida is not null
   and coalesce(dias, 0) <> greatest((saida - entrada), 0);
