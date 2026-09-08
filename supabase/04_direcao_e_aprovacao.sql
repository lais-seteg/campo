-- ═══════════════════════════════════════════════════════════════════════
--  SOLICITAÇÃO DE CAMPO · Seteg — v3: DIREÇÃO E APROVAÇÃO DO LÍDER
--
--  Rode DEPOIS de 02_campo_v2.sql. Idempotente.
--
--  ── O QUE MUDA, E POR QUÊ ──
--
--  1. Entra um papel ACIMA da Gestão: `direcao`. Só ela cadastra projeto
--     e líder — nem Gestão, nem líder, nem colaborador chegam nesse
--     cadastro. E é dele que sai quem aprova cada campo.
--
--  2. A APROVAÇÃO VOLTA, mas é outra. A que foi retirada em 02_campo_v2
--     era da Gestão e autorizava gasto. Esta é do LÍDER DO PROJETO e
--     responde outra pergunta: "este campo é do escopo do meu projeto?".
--     Duas perguntas diferentes, de duas pessoas diferentes — por isso
--     tirar uma e pôr a outra não é contradição.
--
--  3. `projetos.lider` era texto livre. Texto livre não aprova nada: para
--     o líder poder decidir, ele tem de ser uma PESSOA do sistema. Entra
--     `lider_id` apontando para `perfis`; o texto continua existindo como
--     cópia do nome, mantida por trigger, para as telas e o CSV que já
--     liam dele.
--
--  ── O FLUXO ──
--
--      Aguardando aprovação → Aprovada → Logística confirmada
--                           → Em campo → Finalizada
--      (Recusada pelo líder, com motivo · Cancelada a qualquer momento)
--
--  Quem pede sendo o próprio líder não espera por si mesmo: nasce
--  Aprovada. A Direção também aprova — líder de férias não pode travar o
--  campo inteiro.
--
--  ── SER LÍDER NÃO É PAPEL ──
--  É ser `lider_id` de uma linha de `projetos`. Um colaborador pode
--  liderar um projeto e não liderar outro, e é por isso que a pergunta
--  certa nunca é "esta pessoa é líder?", e sim "esta pessoa é líder DESTE
--  projeto?".
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- ═══════════════════════════════════════════════════════════════════════
--  1. O PAPEL NOVO
-- ═══════════════════════════════════════════════════════════════════════
alter table public.perfis drop constraint if exists perfis_papel_check;
alter table public.perfis add constraint perfis_papel_check
  check (papel in ('direcao', 'gestor', 'tecnico'));

comment on column public.perfis.papel is
  'direcao = Direção (cadastra projetos e líderes; pode tudo que a Gestão pode); gestor = Gestão; tecnico = cadastra e edita. Quem lidera projeto não é papel: é ser lider_id de uma linha de projetos.';

create or replace function public.eh_direcao()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.papel_atual() = 'direcao', false)
$$;

-- Direção é ACIMA da Gestão: onde a política já pedia Gestão, a Direção
-- passa também. Sem isto, o papel de cima teria menos poder que o de
-- baixo. Atenção: esta função é usada pelos DOIS sistemas (campo e
-- estoque), e é de propósito — a Direção exclui item no estoque também.
create or replace function public.eh_gestor()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.papel_atual() in ('gestor', 'direcao'), false)
$$;

revoke execute on function public.eh_direcao() from public, anon;
grant  execute on function public.eh_direcao() to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
--  2. PROJETO: LÍDER É PESSOA, E PROGRAMAS DESENVOLVIDOS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.projetos add column if not exists lider_id uuid references public.perfis(id) on delete restrict;
-- Texto livre de propósito: os programas variam por contrato (Fauna,
-- Flora, Ambiental, Qualidade do Ar…) e lista fechada envelheceria no
-- primeiro projeto novo.
alter table public.projetos add column if not exists programas text;

-- Só aperta a exigência se nenhuma linha ficaria de fora. Cadastro vazio
-- aperta na hora; banco com projeto antigo incompleto continua de pé e a
-- tela cobra o preenchimento.
do $blk$
begin
  if not exists (select 1 from public.projetos where lider_id is null) then
    alter table public.projetos alter column lider_id set not null;
  end if;
  if not exists (select 1 from public.projetos
                  where length(btrim(coalesce(programas, ''))) = 0) then
    alter table public.projetos
      add constraint projetos_programas_check
      check (length(btrim(coalesce(programas, ''))) > 0);
  end if;
exception when duplicate_object then null;
end $blk$;

comment on column public.projetos.lider_id is
  'Quem aprova as solicitações de campo deste projeto. É perfil, não texto: texto livre não aprova nada.';
comment on column public.projetos.programas is
  'Programas desenvolvidos no projeto (Fauna, Flora, Ambiental…). Texto livre: a lista muda a cada contrato.';
comment on column public.projetos.lider is
  'Cópia do nome do líder, mantida por trigger a partir de lider_id. Existe para as telas e o CSV — quem manda é lider_id.';

-- O nome do líder acompanha o perfil: trocar o nome em perfis não pode
-- deixar o projeto mostrando o nome antigo.
create or replace function public.projetos_nome_do_lider()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.lider_id is not null then
    select p.nome into new.lider from public.perfis p where p.id = new.lider_id;
  end if;
  return new;
end;
$$;

-- Dispara depois de projetos_carimbo (ordem alfabética do nome do
-- trigger), e os dois são BEFORE — não se atropelam.
drop trigger if exists projetos_nome_do_lider on public.projetos;
create trigger projetos_nome_do_lider before insert or update on public.projetos
  for each row execute function public.projetos_nome_do_lider();

revoke execute on function public.projetos_nome_do_lider() from public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════
--  3. QUEM LIDERA O QUÊ
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.eh_lider_do_projeto(p_projeto uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.projetos pr
     where pr.id = p_projeto
       and pr.lider_id = (select auth.uid()))
$$;

-- Lidera algum projeto? É o que acende a aba de aprovações na tela.
create or replace function public.eh_lider()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.projetos pr where pr.lider_id = (select auth.uid()))
$$;

revoke execute on function public.eh_lider_do_projeto(uuid) from public, anon;
revoke execute on function public.eh_lider()                from public, anon;
grant  execute on function public.eh_lider_do_projeto(uuid) to authenticated;
grant  execute on function public.eh_lider()                to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
--  4. RLS: O CADASTRO DE PROJETOS É SÓ DA DIREÇÃO
--
--  Consultar é de todo mundo — o solicitante precisa escolher o projeto
--  no formulário. Criar, editar e excluir é exclusivo da Direção. As
--  políticas de 02_campo_v2 davam isso a qualquer usuário ativo, e são
--  substituídas aqui.
-- ═══════════════════════════════════════════════════════════════════════
drop policy if exists "projetos: usuário ativo consulta" on public.projetos;
drop policy if exists "projetos: usuário ativo cadastra" on public.projetos;
drop policy if exists "projetos: usuário ativo edita"    on public.projetos;
drop policy if exists "projetos: só Gestão exclui"       on public.projetos;
drop policy if exists "projetos: só Direção cadastra"    on public.projetos;
drop policy if exists "projetos: só Direção edita"       on public.projetos;
drop policy if exists "projetos: só Direção exclui"      on public.projetos;

create policy "projetos: usuário ativo consulta" on public.projetos
  for select to authenticated using (public.eh_usuario_ativo());

create policy "projetos: só Direção cadastra" on public.projetos
  for insert to authenticated with check (public.eh_direcao());

create policy "projetos: só Direção edita" on public.projetos
  for update to authenticated using (public.eh_direcao()) with check (public.eh_direcao());

create policy "projetos: só Direção exclui" on public.projetos
  for delete to authenticated using (public.eh_direcao());


-- ═══════════════════════════════════════════════════════════════════════
--  5. O FLUXO COM APROVAÇÃO
-- ═══════════════════════════════════════════════════════════════════════
alter table public.solicitacoes add column if not exists aprovado_por uuid references auth.users(id) on delete set null;
alter table public.solicitacoes add column if not exists aprovado_em  timestamptz;
alter table public.solicitacoes add column if not exists motivo_recusa text;

alter table public.solicitacoes drop constraint if exists solicitacoes_status_check;
update public.solicitacoes set status = 'Aprovada' where status = 'Solicitada';
alter table public.solicitacoes alter column status set default 'Aguardando aprovação';
alter table public.solicitacoes add constraint solicitacoes_status_check check (
  status in ('Aguardando aprovação', 'Aprovada', 'Logística confirmada',
             'Em campo', 'Finalizada', 'Cancelada', 'Recusada')
);

alter table public.solicitacoes drop constraint if exists solicitacoes_recusa_check;
alter table public.solicitacoes add constraint solicitacoes_recusa_check check (
  status <> 'Recusada' or length(btrim(coalesce(motivo_recusa, ''))) > 0
);

comment on column public.solicitacoes.status is
  'Aguardando aprovação → Aprovada → Logística confirmada → Em campo → Finalizada. Recusada pelo líder (com motivo) ou Cancelada a qualquer momento. A aprovação é do LÍDER DO PROJETO, não da Gestão.';
comment on column public.solicitacoes.projeto_id is
  'Obrigatório em pedido novo: é ele que diz QUEM aprova. Sem projeto não há líder, e sem líder não há aprovação.';


-- ── O trigger do cabeçalho, com a aprovação ──
create or replace function public.solicitacoes_antes_de_gravar()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_prev numeric(14,2); v_real numeric(14,2);
  v_lider uuid;
begin
  if tg_op = 'INSERT' then
    new.solicitante_id   := (select auth.uid());
    new.solicitante_nome := coalesce(public.nome_atual(), new.solicitante_nome);

    -- Sem projeto não há líder, e sem líder não há quem aprove. Por isso
    -- escolher o projeto deixa de ser opcional no pedido novo.
    if new.projeto_id is null then
      raise exception 'Escolha o projeto: é o líder dele que aprova a solicitação de campo.';
    end if;
    select pr.lider_id into v_lider from public.projetos pr where pr.id = new.projeto_id;
    if v_lider is null then
      raise exception 'O projeto escolhido está sem líder. A Direção precisa completar o cadastro.';
    end if;

    -- Quem pede sendo o líder do projeto não espera por si mesmo. Direção
    -- também não: ela está acima de quem aprovaria.
    if v_lider = (select auth.uid()) or public.eh_direcao() then
      new.status       := 'Aprovada';
      new.aprovado_por := (select auth.uid());
      new.aprovado_em  := now();
    else
      new.status := 'Aguardando aprovação';
    end if;
  else
    new.codigo           := old.codigo;
    new.criado_em        := old.criado_em;
    new.solicitante_id   := old.solicitante_id;
    new.solicitante_nome := old.solicitante_nome;

    if new.status is distinct from old.status then
      -- Quatro estados não saem de edição direta, cada par pela sua razão:
      --  Aprovada/Recusada  — são o ato do líder, e passam pela função que
      --                       confere se quem chama lidera aquele projeto;
      --  Em campo/Finalizada — são consequência da conferência, que é quem
      --                       mexe no saldo do estoque.
      -- As funções avisam que são elas falando pelas chaves abaixo.
      if new.status in ('Aprovada', 'Recusada')
         and coalesce(current_setting('campo.aprovacao', true), '') <> 'on' then
        raise exception 'Aprovar ou recusar é do líder do projeto, pela tela de aprovações.';
      end if;
      if new.status in ('Em campo', 'Finalizada')
         and coalesce(current_setting('campo.conferencia', true), '') <> 'on' then
        raise exception 'Em campo e Finalizada saem da conferência de equipamentos, não de edição direta.';
      end if;
      -- Logística só depois de aprovado: confirmar hotel e carro de um
      -- campo que o líder ainda não validou é gastar antes da hora.
      if new.status = 'Logística confirmada' and old.status = 'Aguardando aprovação' then
        raise exception 'A solicitação % ainda espera a aprovação do líder do projeto.', old.codigo;
      end if;
      if new.status = 'Logística confirmada' and old.status <> 'Logística confirmada' then
        new.logistica_por := (select auth.uid());
        new.logistica_em  := now();
      end if;
      if new.status = 'Cancelada' then
        new.cancelado_por := (select auth.uid());
        new.cancelado_em  := now();
      end if;
    end if;
  end if;

  -- Previsto × real: totais, desvio e status de curso (faixa de 5%).
  v_prev := coalesce(new.previsto_veiculo, 0) + coalesce(new.previsto_hospedagem, 0)
          + coalesce(new.previsto_alimentacao, 0) + coalesce(new.previsto_outros, 0);
  v_real := coalesce(new.real_veiculo, 0) + coalesce(new.real_hospedagem, 0)
          + coalesce(new.real_alimentacao, 0) + coalesce(new.real_outros, 0);

  new.previsto_total    := v_prev;
  new.real_total        := v_real;
  new.desvio_valor      := v_real - v_prev;
  new.desvio_percentual := case when v_prev > 0 then round((v_real - v_prev) / v_prev * 100, 2) end;
  new.status_curso      := case
    when v_prev = 0 and v_real = 0 then 'Sem realizado'
    when v_prev = 0                then 'Sem previsto'
    when v_real = 0                then 'Sem realizado'
    when v_real <  v_prev * 0.95   then 'Abaixo do previsto'
    when v_real <= v_prev * 1.05   then 'Dentro do previsto'
    else                                'Acima do previsto'
  end;

  new.sst_identificacao := case
    when not new.sst_aplicavel then 'Não aplicável'
    when new.sst_apr_emitida and new.sst_pt_emitida and new.sst_dds_realizado
         and new.sst_treinamento_conferido and new.sst_aso_conferido
         and new.sst_epi_conferido then 'Conforme'
    else 'Pendente'
  end;

  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists solicitacoes_antes_de_gravar on public.solicitacoes;
create trigger solicitacoes_antes_de_gravar
  before insert or update on public.solicitacoes
  for each row execute function public.solicitacoes_antes_de_gravar();


-- ── O ATO DO LÍDER ──
-- Aprovar ou recusar, numa transação: quem pode é o líder DAQUELE projeto
-- (ou a Direção). Recusa solta a reserva — material preso num campo que
-- não vai acontecer é material que falta em outro.
create or replace function public.aprovar_solicitacao_lider(
  p_solicitacao uuid, p_aprovar boolean, p_motivo text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_codigo text; v_status text; v_projeto uuid; v_lider uuid; v_liberadas integer := 0;
begin
  if not public.eh_usuario_ativo() then
    raise exception 'Sem permissão.';
  end if;

  select s.codigo, s.status, s.projeto_id into v_codigo, v_status, v_projeto
    from public.solicitacoes s where s.id = p_solicitacao for update;
  if not found then
    raise exception 'Solicitação não encontrada.';
  end if;
  if v_status <> 'Aguardando aprovação' then
    raise exception 'A solicitação % está % — não há aprovação pendente.', v_codigo, v_status;
  end if;

  select pr.lider_id into v_lider from public.projetos pr where pr.id = v_projeto;
  if v_lider is distinct from (select auth.uid()) and not public.eh_direcao() then
    raise exception 'Só o líder do projeto (ou a Direção) aprova a solicitação %.', v_codigo;
  end if;

  perform set_config('campo.aprovacao', 'on', true);

  if p_aprovar then
    update public.solicitacoes
       set status = 'Aprovada', aprovado_por = (select auth.uid()), aprovado_em = now()
     where id = p_solicitacao;
    return jsonb_build_object('codigo', v_codigo, 'status', 'Aprovada');
  end if;

  if length(btrim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'Recusar exige o motivo.';
  end if;

  select public.liberar_reservas_solicitacao(p_solicitacao) into v_liberadas;
  update public.solicitacoes
     set status = 'Recusada', motivo_recusa = btrim(p_motivo)
   where id = p_solicitacao;

  return jsonb_build_object('codigo', v_codigo, 'status', 'Recusada', 'liberadas', v_liberadas);
end;
$$;

revoke execute on function public.aprovar_solicitacao_lider(uuid, boolean, text) from public, anon;
grant  execute on function public.aprovar_solicitacao_lider(uuid, boolean, text) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
--  6. CAMPO RECUSADO NÃO RESERVA, NÃO SAI E NÃO ACEITA ACRÉSCIMO
--
--  As três funções abaixo já recusavam Finalizada e Cancelada. Recusada é
--  a mesma situação, e a entrega ganha uma checagem a mais: equipamento
--  não sai para um campo que o líder ainda não aprovou.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.reservar_equipamentos_solicitacao(p_solicitacao uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_inicio date; v_fim date; v_status text; v_codigo text;
  v_faltas text := '';
  v_disponivel integer;
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

  -- Trava as linhas do catálogo ANTES de conferir saldo: dois pedidos
  -- simultâneos do mesmo item entram em fila em vez de os dois lerem o
  -- mesmo saldo e os dois passarem.
  perform 1
     from public.itens i
    where i.id in (select e.item_id
                     from public.solicitacao_equipamentos e
                    where e.solicitacao_id = p_solicitacao
                      and e.item_id is not null)
    order by i.id
      for update;

  -- Sem apelido de tabela: `r` é variável nesta função, e em PL/pgSQL a
  -- variável ganha do apelido.
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
        v_faltas := v_faltas || format('%s (%s): pedido %s, disponível %s de %s a %s; ',
          r.produto, r.codigo, r.pedido, v_disponivel,
          to_char(v_inicio, 'DD/MM/YYYY'), to_char(v_fim, 'DD/MM/YYYY'));
      end if;
    end if;
  end loop;

  if v_faltas <> '' then
    raise exception 'Material indisponível nas datas do campo — %', rtrim(v_faltas, '; ');
  end if;

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
$$;


create or replace function public.registrar_entrega_solicitacao(
  p_solicitacao uuid, p_data date, p_adm text, p_prestador text, p_itens jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_status text; v_codigo text; v_baixados integer := 0; v_saldo integer; r record;
begin
  if not public.eh_usuario_ativo() then
    raise exception 'Sem permissão para registrar entrega.';
  end if;
  if p_data is null or length(btrim(coalesce(p_adm, ''))) = 0
     or length(btrim(coalesce(p_prestador, ''))) = 0 then
    raise exception 'Data e as duas assinaturas são obrigatórias na entrega.';
  end if;

  select s.status, s.codigo into v_status, v_codigo
    from public.solicitacoes s where s.id = p_solicitacao for update;
  if not found then
    raise exception 'Solicitação não encontrada.';
  end if;
  -- Equipamento não sai para um campo que o líder ainda não aprovou.
  if v_status = 'Aguardando aprovação' then
    raise exception 'A solicitação % ainda espera a aprovação do líder do projeto.', v_codigo;
  end if;
  if v_status in ('Recusada', 'Finalizada', 'Cancelada') then
    raise exception 'A solicitação % está % — não há entrega a registrar.', v_codigo, v_status;
  end if;

  update public.solicitacao_equipamentos e
     set entregue      = coalesce((t.j->>'entregue')::boolean, e.entregue),
         teste_entrega = coalesce((t.j->>'teste')::boolean, e.teste_entrega)
    from jsonb_array_elements(p_itens) as t(j)
   where e.id = (t.j->>'id')::uuid
     and e.solicitacao_id = p_solicitacao;

  perform 1 from public.itens i
    where i.id in (select e.item_id from public.solicitacao_equipamentos e
                    where e.solicitacao_id = p_solicitacao and e.item_id is not null)
    order by i.id for update;

  for r in
    select e.id, e.item_id, e.quantidade, i.produto, i.codigo
      from public.solicitacao_equipamentos e
      join public.itens i on i.id = e.item_id
     where e.solicitacao_id = p_solicitacao
       and e.item_id is not null
       and e.entregue
       -- Idempotente: item cuja reserva já está em campo (ou já voltou)
       -- não é baixado de novo. Retry de rede não pode furar o saldo.
       and not exists (
         select 1 from public.item_reservas x
          where x.solicitacao_equipamento_id = e.id
            and x.situacao in ('Em campo', 'Devolvido'))
  loop
    -- O saldo é lido DENTRO do laço: o mesmo item pode aparecer em duas
    -- linhas do pedido, e a segunda precisa ver o estoque já descontado.
    select i.estoque_atual into v_saldo from public.itens i where i.id = r.item_id;
    if v_saldo < r.quantidade then
      raise exception 'Saldo insuficiente de % (%): % em estoque, % na entrega.',
        r.produto, r.codigo, v_saldo, r.quantidade;
    end if;

    update public.itens
       set estoque_atual = estoque_atual - r.quantidade
     where id = r.item_id;

    perform public.campo_marcar_movimentacao(
      r.item_id, 'Saída', format('Saída para a solicitação de campo %s', v_codigo));

    update public.item_reservas
       set situacao = 'Em campo', baixado_em = now()
     where solicitacao_equipamento_id = r.id
       and situacao = 'Reservado';

    if not found then
      insert into public.item_reservas
             (item_id, solicitacao_id, solicitacao_equipamento_id, quantidade,
              inicio, fim, situacao, baixado_em)
      select r.item_id, p_solicitacao, r.id, r.quantidade,
             coalesce(s.periodo_inicio, p_data), coalesce(s.periodo_fim, p_data),
             'Em campo', now()
        from public.solicitacoes s where s.id = p_solicitacao;
    end if;

    v_baixados := v_baixados + 1;
  end loop;

  if not exists (
    select 1 from public.solicitacao_equipamentos e
     where e.solicitacao_id = p_solicitacao and e.entregue) then
    raise exception 'Marque ao menos um equipamento como entregue.';
  end if;

  perform set_config('campo.conferencia', 'on', true);
  update public.solicitacoes
     set entrega_data      = p_data,
         entrega_adm       = upper(btrim(p_adm)),
         entrega_prestador = upper(btrim(p_prestador)),
         status            = 'Em campo'
   where id = p_solicitacao;

  return jsonb_build_object('codigo', v_codigo, 'baixados', v_baixados);
end;
$$;


create or replace function public.acrescentar_equipamento_solicitacao(
  p_solicitacao uuid, p_item uuid, p_quantidade integer, p_descricao text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_status text; v_codigo text; v_nome text;
begin
  if not public.eh_usuario_ativo() then
    raise exception 'Sem permissão.';
  end if;
  if coalesce(p_quantidade, 0) <= 0 then
    raise exception 'A quantidade do acréscimo precisa ser maior que zero.';
  end if;

  select s.status, s.codigo into v_status, v_codigo
    from public.solicitacoes s where s.id = p_solicitacao;
  if not found then
    raise exception 'Solicitação não encontrada.';
  end if;
  if v_status in ('Finalizada', 'Cancelada', 'Recusada') then
    raise exception 'A solicitação % está % — não aceita acréscimo.', v_codigo, v_status;
  end if;

  insert into public.solicitacao_equipamentos (solicitacao_id, item_id, descricao, quantidade)
  values (p_solicitacao, p_item, nullif(btrim(coalesce(p_descricao, '')), ''), p_quantidade)
  returning id into v_id;

  if p_item is not null then
    -- Refaz a reserva inteira: se o acréscimo não couber nas datas, a
    -- exceção desfaz o insert acima junto.
    perform public.reservar_equipamentos_solicitacao(p_solicitacao);
    select i.produto || ' · ' || i.codigo into v_nome from public.itens i where i.id = p_item;
  end if;

  insert into public.solicitacao_alteracoes (solicitacao_id, tipo, campo, de, para)
  values (p_solicitacao, 'Acréscimo', 'Equipamento', null,
          format('%s × %s', p_quantidade, coalesce(v_nome, p_descricao, 'item sem catálogo')));

  return v_id;
end;
$$;

commit;


-- ═══════════════════════════════════════════════════════════════════════
--  CONFERÊNCIA
-- ═══════════════════════════════════════════════════════════════════════
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('eh_direcao', 'eh_lider', 'eh_lider_do_projeto',
                        'aprovar_solicitacao_lider'))                    as funcoes_de_4,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'projetos'
      and column_name in ('lider_id', 'programas'))                      as colunas_de_2,
  (select count(*) from pg_policies where schemaname = 'public'
      and tablename = 'projetos' and policyname like '%Direção%')         as politicas_direcao_de_3,
  (select count(*) from public.solicitacoes where status not in
    ('Aguardando aprovação', 'Aprovada', 'Logística confirmada',
     'Em campo', 'Finalizada', 'Cancelada', 'Recusada'))                  as status_invalidos_zero,
  (select count(*) from public.projetos where lider_id is null)           as projetos_sem_lider_zero;
