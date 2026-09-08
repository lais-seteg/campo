-- ═══════════════════════════════════════════════════════════════════════
--  12 · A FOLGA VIRA DECISÃO DO ADMINISTRATIVO
--
--  Rode depois de 11_margem_de_reserva.sql.
--
--  ── O QUE O 11 DEIXOU PELA METADE ──
--
--  O 11 fez a reserva pegar um dia antes e um depois. Certo como padrão, e
--  errado como lei: a folga existe para separar, transportar e conferir na
--  volta, e às vezes ela não é necessária — o campo anterior volta de manhã
--  e o próximo sai à tarde, do mesmo galpão. Quem sabe disso é o
--  ADMINISTRATIVO, que é quem opera a logística. O sistema não tem como
--  saber, e não deveria decidir sozinho.
--
--  ── A DISTINÇÃO QUE ESTE ARQUIVO CRIA ──
--
--  Passam a existir DOIS motivos para um item não poder sair, e eles não se
--  parecem:
--
--    CONFLITO REAL   — outro campo está com o item NAS MESMAS DATAS. É o
--                      mesmo medidor em duas cidades ao mesmo tempo.
--                      Continua sendo erro duro: nenhuma autorização
--                      resolve, e nada é gravado.
--
--    SÓ A FOLGA      — o item está livre nas datas do campo, e o que
--                      atrapalha é a véspera ou o dia seguinte de OUTRO
--                      campo. Isso é julgamento de logística, não de
--                      estoque. Deixa de ser erro.
--
--  ── O PEDIDO PRECISA EXISTIR PARA ALGUÉM PODER LIBERÁ-LO ──
--
--  Era essa a peça que faltava. Antes, um pedido barrado pela folga não
--  salvava — e um pedido que não existe não tem o que ser liberado; a
--  conversa acontecia fora do sistema e o registro se perdia.
--
--  Agora o pedido NASCE, e a linha do equipamento fica AGUARDANDO
--  LIBERAÇÃO: gravada, visível, sem reserva. O administrativo a vê, libera
--  (e aí sim a reserva é criada) ou não libera — e o pedido segue sem
--  aquele item, o que é diferente de o pedido não existir.
--
--  Como a reserva só nasce na liberação, duas pessoas aguardando o mesmo
--  item não travam nada uma da outra: quem for liberado primeiro reserva
--  primeiro, e a segunda liberação reconfere o saldo e recusa se não
--  couber.
--
--  Idempotente.
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
--  A DISPENSA, NA LINHA DO EQUIPAMENTO
--
--  Na LINHA e não na solicitação inteira: a decisão é sobre um item ("este
--  medidor pode sair coladinho, aquele tripé não"), e é assim que o pedido
--  foi feito.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.solicitacao_equipamentos
  add column if not exists folga_dispensada boolean not null default false,
  add column if not exists folga_dispensada_por uuid references public.perfis(id),
  add column if not exists folga_dispensada_em timestamptz,
  add column if not exists folga_dispensada_motivo text;

comment on column public.solicitacao_equipamentos.folga_dispensada is
  'O administrativo liberou este item para sair sem a folga de margem_reserva_dias(). Nunca dispensa CONFLITO REAL de datas — só a folga.';


-- ═══════════════════════════════════════════════════════════════════════
--  `item_comprometido` PASSA A ACEITAR A MARGEM
--
--  `p_margem_dias` nulo = o padrão de `margem_reserva_dias()`. Zero = só a
--  sobreposição crua, que é o que responde "há conflito REAL?".
--
--  DROP e CREATE, e não CREATE OR REPLACE: acrescentar parâmetro cria uma
--  sobrecarga, e aí toda chamada com quatro argumentos ficaria ambígua.
--  Os dois únicos chamadores são recriados logo abaixo.
-- ═══════════════════════════════════════════════════════════════════════
drop function if exists public.item_comprometido(uuid, date, date, uuid);

create or replace function public.item_comprometido(
  p_item uuid,
  p_inicio date,
  p_fim date,
  p_ignorar_solicitacao uuid default null::uuid,
  p_margem_dias integer default null
) returns integer
language sql stable security definer set search_path to ''
as $function$
  select coalesce(sum(r.quantidade), 0)::integer
    from public.item_reservas r
   where r.item_id = p_item
     and r.situacao in ('Reservado', 'Em campo')
     and (p_ignorar_solicitacao is null or r.solicitacao_id <> p_ignorar_solicitacao)
     and r.inicio - coalesce(p_margem_dias, public.margem_reserva_dias()) <= p_fim
     and r.fim    + coalesce(p_margem_dias, public.margem_reserva_dias()) >= p_inicio
$function$;

comment on function public.item_comprometido(uuid, date, date, uuid, integer) is
  'Quanto de um item já está comprometido no período. p_margem_dias nulo usa margem_reserva_dias(); 0 responde "há conflito REAL de datas?". Único lugar do sistema que compara datas de reserva.';

revoke all    on function public.item_comprometido(uuid, date, date, uuid, integer) from public, anon;
grant  execute on function public.item_comprometido(uuid, date, date, uuid, integer) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
--  O CATÁLOGO DO FORMULÁRIO
--
--  Ganha `comprometido_estrito` e `disponivel_estrito`: o mesmo cálculo sem
--  a folga. É o que deixa a tela dizer "está livre, mas encosta na folga de
--  outro campo — precisa de liberação" em vez do genérico "indisponível".
--  Sem essas duas colunas, quem preenche não distingue o que é negociável
--  do que não é.
-- ═══════════════════════════════════════════════════════════════════════
drop function if exists public.itens_disponiveis_no_periodo(date, date, uuid);

create or replace function public.itens_disponiveis_no_periodo(
  p_inicio date,
  p_fim date,
  p_ignorar_solicitacao uuid default null::uuid
) returns table(
  item_id uuid, codigo text, produto text, categoria text,
  estoque_atual integer, em_manutencao boolean,
  comprometido integer, disponivel integer,
  comprometido_estrito integer, disponivel_estrito integer
)
language sql stable security definer set search_path to ''
as $function$
  select i.id, i.codigo, i.produto, i.categoria, i.estoque_atual, i.em_manutencao,
         public.item_comprometido(i.id, p_inicio, p_fim, p_ignorar_solicitacao),
         case when i.em_manutencao then 0
              else greatest(i.estoque_atual
                     - public.item_comprometido(i.id, p_inicio, p_fim, p_ignorar_solicitacao), 0)
         end,
         public.item_comprometido(i.id, p_inicio, p_fim, p_ignorar_solicitacao, 0),
         case when i.em_manutencao then 0
              else greatest(i.estoque_atual
                     - public.item_comprometido(i.id, p_inicio, p_fim, p_ignorar_solicitacao, 0), 0)
         end
    from public.itens i
   where public.eh_usuario_ativo()
   order by i.produto
$function$;

revoke all    on function public.itens_disponiveis_no_periodo(date, date, uuid) from public, anon;
grant  execute on function public.itens_disponiveis_no_periodo(date, date, uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
--  A RESERVA, COM AS DUAS PORTAS
--
--  Conflito real → exceção, nada é gravado (como sempre foi).
--  Só a folga    → a linha fica sem reserva, aguardando o administrativo.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.reservar_equipamentos_solicitacao(p_solicitacao uuid)
returns integer language plpgsql security definer set search_path to ''
as $function$
declare
  v_inicio date; v_fim date; v_status text; v_codigo text;
  v_faltas text := '';
  v_disp_estrito integer;
  v_disp_com_folga integer;
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

  -- ── PRIMEIRA PASSADA: só o que é INEGOCIÁVEL ──
  -- `p_margem_dias => 0` pergunta apenas se há outro campo nas MESMAS
  -- datas. Se houver, nada é gravado — nem as linhas que estariam boas.
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
      v_disp_estrito := greatest(
        r.estoque_atual - public.item_comprometido(r.item_id, v_inicio, v_fim, p_solicitacao, 0), 0);
      if r.pedido > v_disp_estrito then
        v_faltas := v_faltas || format('%s (%s): pedido %s, disponível %s de %s a %s; ',
          r.produto, r.codigo, r.pedido, v_disp_estrito,
          to_char(v_inicio, 'DD/MM/YYYY'), to_char(v_fim, 'DD/MM/YYYY'));
      end if;
    end if;
  end loop;

  if v_faltas <> '' then
    raise exception
      'Material indisponível nas datas do campo — outro campo está com ele no mesmo período. Isto não é a folga entre campos, é conflito de datas, e não há liberação que resolva: %',
      rtrim(v_faltas, '; ');
  end if;

  -- ── SEGUNDA PASSADA: reserva o que cabe COM a folga ──
  -- O que não couber por causa dela fica sem reserva, aguardando o
  -- administrativo. `bool_or`: basta uma linha do item estar liberada para
  -- o item sair — a dispensa é sobre o item dentro deste pedido.
  insert into public.item_reservas
        (item_id, solicitacao_id, solicitacao_equipamento_id, quantidade, inicio, fim)
  select e.item_id, e.solicitacao_id, e.id, e.quantidade, v_inicio, v_fim
    from public.solicitacao_equipamentos e
    join public.itens i on i.id = e.item_id
   where e.solicitacao_id = p_solicitacao
     and e.item_id is not null
     and not e.entregue
     and not i.em_manutencao
     and (
       -- liberado pelo administrativo: a folga não conta
       exists (select 1 from public.solicitacao_equipamentos e2
                where e2.solicitacao_id = e.solicitacao_id
                  and e2.item_id = e.item_id
                  and e2.folga_dispensada)
       -- ou cabe com a folga aplicada
       or (select sum(e3.quantidade)
             from public.solicitacao_equipamentos e3
            where e3.solicitacao_id = e.solicitacao_id
              and e3.item_id = e.item_id
              and not e3.entregue)
          <= greatest(i.estoque_atual
               - public.item_comprometido(e.item_id, v_inicio, v_fim, p_solicitacao), 0)
     );

  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all    on function public.reservar_equipamentos_solicitacao(uuid) from public, anon;
grant  execute on function public.reservar_equipamentos_solicitacao(uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
--  O QUE ESTÁ AGUARDANDO LIBERAÇÃO
--
--  Derivado, e não uma coluna de estado: linha com item de catálogo, ainda
--  não entregue e SEM reserva. Como conflito real nem chega a salvar e o
--  que cabe é reservado na hora, a única maneira de uma linha ficar sem
--  reserva é a folga. Estado derivado não sai do lugar quando alguém
--  esquece de atualizá-lo.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.equipamentos_aguardando_folga()
returns table(
  equipamento_id uuid, solicitacao_id uuid, codigo text, cliente_projeto text,
  status text, periodo_inicio date, periodo_fim date,
  item_id uuid, produto text, item_codigo text, quantidade integer,
  disponivel_estrito integer
)
language sql stable security definer set search_path to ''
as $function$
  select e.id, s.id, s.codigo, s.cliente_projeto, s.status,
         s.periodo_inicio, s.periodo_fim,
         i.id, i.produto, i.codigo, e.quantidade,
         greatest(i.estoque_atual
           - public.item_comprometido(i.id, s.periodo_inicio, s.periodo_fim, s.id, 0), 0)
    from public.solicitacao_equipamentos e
    join public.solicitacoes s on s.id = e.solicitacao_id
    join public.itens i        on i.id = e.item_id
   where public.eh_usuario_ativo()
     and e.item_id is not null
     and not e.entregue
     and s.status not in ('Finalizada', 'Cancelada', 'Recusada')
     and not exists (select 1 from public.item_reservas r
                      where r.solicitacao_equipamento_id = e.id
                        and r.situacao in ('Reservado', 'Em campo'))
   order by s.periodo_inicio, s.codigo, i.produto
$function$;

revoke all    on function public.equipamentos_aguardando_folga() from public, anon;
grant  execute on function public.equipamentos_aguardando_folga() to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
--  A AÇÃO DO ADMINISTRATIVO
--
--  Só administrativo e Direção. A Gestão não entra: quem responde pela
--  logística do material é quem opera, e a Direção porque o acesso dela é
--  total.
--
--  Liberar RESERVA na mesma transação. Se entre o pedido e a liberação
--  outro campo tiver levado o item, a reserva não acontece e a função diz
--  isso — em vez de marcar "liberado" sobre material que não existe mais.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.liberar_folga_equipamento(
  p_equipamento uuid,
  p_liberar boolean default true,
  p_motivo text default null
) returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare
  v_solicitacao uuid; v_item uuid; v_codigo text; v_produto text;
  v_reservado boolean;
begin
  if not (public.eh_administrativo() or public.eh_direcao()) then
    raise exception 'Só o administrativo (ou a Direção) libera a folga entre campos.';
  end if;

  select e.solicitacao_id, e.item_id, s.codigo, i.produto
    into v_solicitacao, v_item, v_codigo, v_produto
    from public.solicitacao_equipamentos e
    join public.solicitacoes s on s.id = e.solicitacao_id
    left join public.itens i   on i.id = e.item_id
   where e.id = p_equipamento;

  if not found then
    raise exception 'Equipamento não encontrado no pedido.';
  end if;
  if v_item is null then
    raise exception 'Este item não é do catálogo — não há folga a liberar.';
  end if;

  update public.solicitacao_equipamentos
     set folga_dispensada       = coalesce(p_liberar, true),
         folga_dispensada_por   = case when coalesce(p_liberar, true) then (select auth.uid()) end,
         folga_dispensada_em    = case when coalesce(p_liberar, true) then now() end,
         folga_dispensada_motivo = case when coalesce(p_liberar, true)
                                        then nullif(btrim(coalesce(p_motivo, '')), '') end
   where id = p_equipamento;

  -- Refaz a reserva do pedido inteiro: é ela que decide o que passa a caber.
  perform public.reservar_equipamentos_solicitacao(v_solicitacao);

  select exists (select 1 from public.item_reservas r
                  where r.solicitacao_equipamento_id = p_equipamento
                    and r.situacao in ('Reservado', 'Em campo'))
    into v_reservado;

  insert into public.solicitacao_alteracoes (solicitacao_id, tipo, campo, de, para)
  values (v_solicitacao, 'Edição', 'Folga entre campos',
          case when coalesce(p_liberar, true) then 'aguardando liberação' else 'liberada' end,
          case when coalesce(p_liberar, true)
               then format('liberada para %s%s', coalesce(v_produto, 'item'),
                           case when nullif(btrim(coalesce(p_motivo, '')), '') is not null
                                then ' — ' || btrim(p_motivo) else '' end)
               else format('liberação retirada de %s', coalesce(v_produto, 'item')) end);

  if coalesce(p_liberar, true) and not v_reservado then
    raise exception
      'A folga foi liberada, mas o material já não cabe: outro campo levou % entre o pedido e agora.',
      coalesce(v_produto, 'o item');
  end if;

  return v_reservado;
end;
$function$;

revoke all    on function public.liberar_folga_equipamento(uuid, boolean, text) from public, anon;
grant  execute on function public.liberar_folga_equipamento(uuid, boolean, text) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
--  CONFERÊNCIA
-- ═══════════════════════════════════════════════════════════════════════
select p.proname, pg_get_function_identity_arguments(p.oid) as argumentos
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('item_comprometido', 'itens_disponiveis_no_periodo',
                     'reservar_equipamentos_solicitacao', 'equipamentos_aguardando_folga',
                     'liberar_folga_equipamento', 'margem_reserva_dias')
 order by 1;
