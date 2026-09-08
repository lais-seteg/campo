-- ═══════════════════════════════════════════════════════════════════════
--  11 · A MARGEM DE UM DIA NA RESERVA DE MATERIAL
--
--  Rode depois de 10_desempenho.sql.
--
--  ── O QUE MUDA ──
--
--  Material pedido para um campo passa a ficar indisponível também no DIA
--  ANTERIOR e no DIA SEGUINTE ao período do campo.
--
--  O motivo é físico, não contábil: o equipamento não se teletransporta. Ele
--  é separado e conferido na véspera, viaja com a equipe, volta e só então é
--  conferido de novo. Dois campos colados — um terminando dia 12 e outro
--  começando dia 13 — disputavam o mesmo medidor como se a devolução da
--  manhã e a retirada da tarde fossem o mesmo instante. Não são, e quem
--  descobria isso era a equipe do segundo campo, na hora de sair.
--
--  ── ONDE A REGRA MORA ──
--
--  Num lugar só: `item_comprometido()`. Ela é a ÚNICA função que compara
--  datas de reserva; `itens_disponiveis_no_periodo()` (o catálogo que o
--  formulário mostra) e `reservar_equipamentos_solicitacao()` (que grava, e
--  para quem `acrescentar_equipamento_solicitacao()` delega) as duas a
--  chamam. Mudar aqui muda o sistema inteiro de uma vez — a tela e a
--  gravação não podem divergir sobre o que está livre.
--
--  ── A MARGEM ENTRA NA COMPARAÇÃO, NÃO NO DADO ──
--
--  `item_reservas` continua guardando as datas REAIS do campo. Alargar as
--  linhas gravadas faria o sistema mentir sobre quando a equipe esteve
--  fora — e essa data aparece no calendário, no checklist e na conferência.
--  A margem é regra de disputa, então vive em quem julga a disputa.
--
--  ── O EFEITO, EM UMA FRASE ──
--
--  Passa a ser preciso ao menos UM DIA LIVRE entre dois campos que usam o
--  mesmo item. Campo A de 10 a 12 e campo B de 13 a 15 agora conflitam;
--  de 14 a 16, não. E é simétrico: basta alargar um dos lados da comparação
--  para que a regra valha independentemente de quem reservou primeiro.
--
--  Idempotente.
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
--  A MARGEM, COM NOME
--
--  Constante numa função em vez de um `1` solto no meio da comparação: o
--  dia a mais é decisão de operação e vai mudar de ideia um dia (véspera de
--  feriado, campo que volta de madrugada). Assim se muda em UM lugar, e é
--  possível procurar por quem depende dela.
--
--  `immutable` para o planejador embutir a chamada — não custa nada por
--  linha.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.margem_reserva_dias()
returns integer language sql immutable
as $$ select 1 $$;

comment on function public.margem_reserva_dias() is
  'Dias de folga antes e depois do período do campo em que o material ainda conta como comprometido. Separação, viagem e conferência de volta não cabem no mesmo dia.';


-- ═══════════════════════════════════════════════════════════════════════
--  A COMPARAÇÃO
--
--  Era `r.inicio <= p_fim and r.fim >= p_inicio` — a sobreposição crua.
--  Agora cada reserva existente vale por um período alargado pela margem.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.item_comprometido(
  p_item uuid,
  p_inicio date,
  p_fim date,
  p_ignorar_solicitacao uuid default null::uuid
) returns integer
language sql stable security definer set search_path to ''
as $function$
  select coalesce(sum(r.quantidade), 0)::integer
    from public.item_reservas r
   where r.item_id = p_item
     and r.situacao in ('Reservado', 'Em campo')
     and (p_ignorar_solicitacao is null or r.solicitacao_id <> p_ignorar_solicitacao)
     and r.inicio - public.margem_reserva_dias() <= p_fim
     and r.fim    + public.margem_reserva_dias() >= p_inicio
$function$;

comment on function public.item_comprometido(uuid, date, date, uuid) is
  'Quanto de um item já está comprometido no período, contando a margem de margem_reserva_dias() antes e depois de cada reserva. Único lugar do sistema que compara datas de reserva.';

revoke all    on function public.item_comprometido(uuid, date, date, uuid) from public, anon;
grant  execute on function public.item_comprometido(uuid, date, date, uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
--  A MENSAGEM DE RECUSA PRECISA EXPLICAR A MARGEM
--
--  Sem isso, quem pede material para 13/03 e ouve "indisponível de 13/03 a
--  15/03" vai abrir o estoque, ver o item parado na prateleira e concluir
--  que o sistema está errado. O conflito é com o campo que termina dia 12 —
--  e a frase tem de dizer isso.
--
--  O corpo é o mesmo de 02_campo_v2.sql; mudam só as duas mensagens.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.reservar_equipamentos_solicitacao(p_solicitacao uuid)
returns integer language plpgsql security definer set search_path to ''
as $function$
declare
  v_inicio date; v_fim date; v_status text; v_codigo text;
  v_faltas text := '';
  v_disponivel integer;
  v_margem integer := public.margem_reserva_dias();
  v_n integer := 0;
  r record;
begin
  if not public.eh_usuario_ativo() then
    raise exception 'Sem permissão para reservar material.';
  end if;

  select s.periodo_inicio, s.periodo_fim, s.status, s.codigo
    into v_inicio, v_fim, v_status, v_codigo
    from public.solicitacoes s
   where s.id = p_solicitacao;
  if not found then
    raise exception 'Solicitação não encontrada.';
  end if;
  if v_inicio is null or v_fim is null then
    raise exception 'A solicitação % não tem período — sem datas não há como reservar material.', v_codigo;
  end if;
  if v_status in ('Finalizada', 'Cancelada', 'Recusada') then
    raise exception 'A solicitação % está % — não há material a reservar.', v_codigo, v_status;
  end if;

  -- Trava as linhas do catálogo antes de conferir: duas pessoas salvando ao
  -- mesmo tempo não podem furar o estoque.
  perform 1
     from public.itens i
    where i.id in (select e.item_id
                     from public.solicitacao_equipamentos e
                    where e.solicitacao_id = p_solicitacao
                      and e.item_id is not null)
    order by i.id
      for update;

  delete from public.item_reservas
   where solicitacao_id = p_solicitacao
     and situacao = 'Reservado';

  for r in
    select e.item_id, i.produto, i.codigo, i.estoque_atual, i.em_manutencao,
           sum(e.quantidade)::integer as pedido
      from public.solicitacao_equipamentos e
      join public.itens i on i.id = e.item_id
     where e.solicitacao_id = p_solicitacao
       and e.item_id is not null
       and not e.entregue
     group by e.item_id, i.produto, i.codigo, i.estoque_atual, i.em_manutencao
  loop
    if r.em_manutencao then
      v_faltas := v_faltas || format('%s (%s) está em manutenção; ', r.produto, r.codigo);
    else
      v_disponivel := greatest(
        r.estoque_atual - public.item_comprometido(r.item_id, v_inicio, v_fim, p_solicitacao), 0);
      if r.pedido > v_disponivel then
        -- A janela citada é a do CAMPO alargada pela margem: é ela que
        -- explica por que um item "parado na prateleira" não pode sair.
        v_faltas := v_faltas || format('%s (%s): pedido %s, disponível %s entre %s e %s; ',
          r.produto, r.codigo, r.pedido, v_disponivel,
          to_char(v_inicio - v_margem, 'DD/MM/YYYY'),
          to_char(v_fim    + v_margem, 'DD/MM/YYYY'));
      end if;
    end if;
  end loop;

  if v_faltas <> '' then
    raise exception
      'Material indisponível para este campo. A reserva reserva também % dia(s) antes e depois do período, para separar, transportar e conferir na volta — %',
      v_margem, rtrim(v_faltas, '; ');
  end if;

  -- As datas GRAVADAS são as do campo, sem margem: é quando a equipe esteve
  -- fora, e é isso que o calendário e o checklist mostram.
  insert into public.item_reservas
        (item_id, solicitacao_id, solicitacao_equipamento_id, quantidade, inicio, fim)
  select e.item_id, e.solicitacao_id, e.id, e.quantidade, v_inicio, v_fim
    from public.solicitacao_equipamentos e
   where e.solicitacao_id = p_solicitacao
     and e.item_id is not null
     and not e.entregue;

  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all    on function public.reservar_equipamentos_solicitacao(uuid) from public, anon;
grant  execute on function public.reservar_equipamentos_solicitacao(uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
--  CONFERÊNCIA
--
--  Um item, uma reserva de 10 a 12, e três perguntas. Com a margem de 1
--  dia, só a terceira deve encontrar o item livre.
-- ═══════════════════════════════════════════════════════════════════════
select public.margem_reserva_dias() as margem_em_dias;
