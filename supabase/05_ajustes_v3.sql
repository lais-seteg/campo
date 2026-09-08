-- ═══════════════════════════════════════════════════════════════════════
--  05 · AJUSTES DA DIREÇÃO — v3
--
--  Rode DEPOIS de 04_direcao_e_aprovacao.sql. Sete mudanças, todas
--  pedidas pela Direção, e todas idempotentes (dá para rodar duas vezes).
--
--   1. DOIS PAPÉIS NOVOS: `administrativo` e `financeiro`. Eles não
--      cadastram nem aprovam nada — existem porque ALGUÉM fora da Direção
--      precisa ver dinheiro consolidado, e até aqui só havia `gestor` e
--      `tecnico`, nenhum dos dois com essa função.
--   2. PROJETO TEM PRAZO: `data_inicio` e `data_fim`.
--   3. `programas` VIRA `escopo` — é como o contrato chama.
--   4. SITUAÇÃO EM QUATRO ESTADOS: Stand By, Ativo, Cancelado, Finalizado,
--      no lugar do booleano `ativo`. `ativo` continua existindo e é mantido
--      em sincronia por trigger: índices, filtros e políticas leem essa
--      coluna, e trocá-los todos de uma vez seria arriscar o sistema
--      inteiro por causa de um rótulo.
--   5. GASTO PREVISTO POR CATEGORIA: tabela filha, uma linha por gasto,
--      com valor TOTAL do projeto (não mais valor por dia).
--   6. AVARIA É GASTO DO PROJETO: `real_avaria` entra no real da
--      solicitação — logo no total, no desvio e no status de curso.
--   7. SST vira UMA MARCA: se aplica ou não se aplica.
--   8. Fecha o `execute` das funções novas — nenhuma delas deve ser
--      chamável por `/rest/v1/rpc/`.
--
--  ── JÁ APLICADO NA BASE gcaetcrywdadwhaqggxj EM 01/09/2026 ──
--
--  Em cinco migrações nomeadas (v3_papeis_administrativo_e_financeiro,
--  v3_projetos_prazo_escopo_situacao, v3_projeto_gastos_previstos,
--  v3_avaria_no_real_e_sst_em_uma_marca, v3_fecha_execute_das_funcoes_novas).
--  Este arquivo é o mesmo conteúdo em um só lugar, e continua idempotente:
--  rodá-lo de novo não muda nada.
--
--  ── O QUE ESTA MIGRAÇÃO NÃO FAZ ──
--
--  Não apaga `previsto_veiculo_dia`, `previsto_hotel_dia` e
--  `previsto_alimentacao_dia`, nem as seis colunas da conferência de SST.
--  Elas saíram das TELAS, e o dado que já está lá é histórico: apagar
--  coluna é a única operação desta migração que não tem volta.
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
--  1. OS DOIS PAPÉIS NOVOS
--
--  `administrativo` e `financeiro` não cadastram projeto (isso é da
--  Direção) e não aprovam campo (isso é do líder DAQUELE projeto). O que
--  eles têm, e ninguém mais fora da Direção tinha, é VER VALOR
--  CONSOLIDADO: previsto × real, custo de avaria, gasto previsto do
--  projeto.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.perfis drop constraint if exists perfis_papel_check;
alter table public.perfis add constraint perfis_papel_check
  check (papel in ('direcao', 'gestor', 'administrativo', 'financeiro', 'tecnico'));

comment on column public.perfis.papel is
  'direcao = Direção (cadastra projetos e líderes; pode tudo que a Gestão pode); gestor = Gestão; administrativo e financeiro = veem valor consolidado, não cadastram nem aprovam; tecnico = cadastra e edita. Quem lidera projeto não é papel: é ser lider_id de uma linha de projetos.';

-- Quem pode ver DINHEIRO CONSOLIDADO. Três papéis por cargo, mais o líder
-- — que vê porque o projeto é dele, não porque o papel dele permite.
--
-- `security definer` porque a função consulta `projetos` para descobrir se
-- a pessoa lidera algo, e ela é chamada de dentro da política de leitura
-- de `projeto_gastos_previstos`: sem isso, uma política dependeria da
-- outra.
create or replace function public.pode_ver_valores()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(
    public.papel_atual() in ('direcao', 'administrativo', 'financeiro')
    or exists (
      select 1 from public.projetos p
       where p.lider_id = (select auth.uid())
    ),
    false)
$$;

comment on function public.pode_ver_valores() is
  'Direção, administrativo, financeiro — ou quem lidera algum projeto. É o que libera valor consolidado (previsto x real, gasto previsto, custo de avaria).';

revoke all on function public.pode_ver_valores() from public;
grant execute on function public.pode_ver_valores() to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
--  2. O PRAZO DO PROJETO
--
--  As datas ficam OPCIONAIS: há projeto cadastrado antes de o contrato ter
--  data, e exigir a data impediria de cadastrar o líder — que é o que
--  destrava o campo.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.projetos add column if not exists data_inicio date;
alter table public.projetos add column if not exists data_fim    date;

alter table public.projetos drop constraint if exists projetos_periodo_check;
alter table public.projetos add constraint projetos_periodo_check check (
  data_inicio is null or data_fim is null or data_fim >= data_inicio
);

comment on column public.projetos.data_inicio is 'Início do projeto (contrato). Opcional: projeto sem data ainda precisa de líder cadastrado.';
comment on column public.projetos.data_fim    is 'Fim previsto do projeto. Nunca antes do início.';


-- ═══════════════════════════════════════════════════════════════════════
--  3. `programas` VIRA `escopo`
--
--  Mesma coluna, mesmo conteúdo (texto separado por vírgula), nome novo.
--  Renomear em vez de criar-e-copiar é o que garante que não sobre uma
--  cópia velha para divergir da nova.
-- ═══════════════════════════════════════════════════════════════════════
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'projetos'
                and column_name = 'programas')
     and not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'projetos'
                        and column_name = 'escopo') then
    alter table public.projetos rename column programas to escopo;
  end if;
end $$;

alter table public.projetos add column if not exists escopo text;

alter table public.projetos drop constraint if exists projetos_programas_check;
alter table public.projetos drop constraint if exists projetos_escopo_check;

-- A trava só entra se nenhuma linha existente a violaria. Migração que
-- falha por causa de dado antigo deixa metade das mudanças aplicadas.
do $$
begin
  if not exists (select 1 from public.projetos
                  where length(btrim(coalesce(escopo, ''))) = 0) then
    alter table public.projetos
      add constraint projetos_escopo_check
      check (length(btrim(coalesce(escopo, ''))) > 0);
  else
    raise notice 'projetos_escopo_check NAO criada: ha projeto sem escopo. Preencha o escopo deles e rode este arquivo de novo.';
  end if;
end $$;

comment on column public.projetos.escopo is
  'O escopo do projeto, um item por linha na tela e texto separado por vírgula aqui. Antes se chamava "programas desenvolvidos".';


-- ═══════════════════════════════════════════════════════════════════════
--  4. SITUAÇÃO EM QUATRO ESTADOS
--
--  Stand By é pausa; Cancelado e Finalizado são fim. SÓ `Ativo` aceita
--  solicitação nova — os três outros somem da lista de projetos ao abrir
--  campo, e os campos já abertos seguem até o fim (pedido em andamento não
--  morre porque o projeto entrou em pausa).
--
--  `ativo` NÃO é apagado: ele passa a ser consequência de `situacao`,
--  mantida por trigger. Índice, filtro e política que já leem `ativo`
--  continuam certos sem serem tocados — e um `update` que ainda mexa só em
--  `ativo` não consegue mais desalinhar as duas colunas.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.projetos add column if not exists situacao text;

-- Retrocompatível: o que estava ativo fica Ativo; o que estava inativo vai
-- para Stand By, o único dos três estados de parada que tem volta. Chamar
-- de Cancelado ou Finalizado seria inventar informação que ninguém deu.
update public.projetos
   set situacao = case when ativo then 'Ativo' else 'Stand By' end
 where situacao is null;

alter table public.projetos alter column situacao set default 'Ativo';
alter table public.projetos alter column situacao set not null;

alter table public.projetos drop constraint if exists projetos_situacao_check;
alter table public.projetos add constraint projetos_situacao_check
  check (situacao in ('Stand By', 'Ativo', 'Cancelado', 'Finalizado'));

create index if not exists projetos_situacao_idx on public.projetos (situacao, cliente, nome);

comment on column public.projetos.situacao is
  'Stand By, Ativo, Cancelado ou Finalizado. Só Ativo aceita solicitação nova. A coluna ativo é derivada desta, por trigger.';
comment on column public.projetos.ativo is
  'DERIVADA de situacao (ativo = situacao é Ativo), mantida por projetos_situacao_sincroniza. Não escreva nela: escreva em situacao.';

-- As duas colunas dizendo a mesma coisa, sempre. Quem escreve `situacao`
-- acerta `ativo`; quem ainda escreve `ativo` (código antigo, script de
-- manutenção) acerta `situacao` — e nunca sobra o par (ativo = true,
-- situacao = 'Cancelado'), que faria a tela e a lista de projetos
-- discordarem.
create or replace function public.projetos_situacao_sincroniza()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.situacao := coalesce(new.situacao,
      case when coalesce(new.ativo, true) then 'Ativo' else 'Stand By' end);
    new.ativo := (new.situacao = 'Ativo');
    return new;
  end if;

  if new.situacao is distinct from old.situacao then
    -- Mudou a situação: ela manda.
    new.ativo := (new.situacao = 'Ativo');
  elsif new.ativo is distinct from old.ativo then
    -- Mudou só o booleano: traduz, sem apagar Cancelado/Finalizado quando
    -- o valor traduzido é o mesmo estado de parada.
    if new.ativo then
      new.situacao := 'Ativo';
    elsif old.situacao = 'Ativo' then
      new.situacao := 'Stand By';
    end if;
    new.ativo := (new.situacao = 'Ativo');
  end if;

  return new;
end;
$$;

drop trigger if exists projetos_situacao_sincroniza on public.projetos;
create trigger projetos_situacao_sincroniza
  before insert or update on public.projetos
  for each row execute function public.projetos_situacao_sincroniza();

-- Alinha o que já está gravado (o trigger só vale de agora em diante).
update public.projetos set ativo = (situacao = 'Ativo')
 where ativo is distinct from (situacao = 'Ativo');


-- ═══════════════════════════════════════════════════════════════════════
--  5. GASTO PREVISTO POR CATEGORIA
--
--  Antes eram TRÊS colunas fixas de valor POR DIA (veículo, hotel,
--  alimentação). Agora é uma tabela filha: a Direção adiciona a categoria
--  que o projeto tem — aluguel de veículo, EPI, licença ambiental, análise
--  laboratorial — com o valor TOTAL previsto para o projeto.
--
--  Tabela filha, e não um `jsonb` numa coluna: é sobre a categoria que se
--  soma ("quanto o campo gasta de veículo no ano"), e categoria dentro de
--  JSON não entra em `group by` sem gambiarra.
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.projeto_gastos_previstos (
  id         uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.projetos(id) on delete cascade,

  categoria text not null check (length(btrim(categoria)) > 0),
  -- TOTAL previsto para o projeto, não valor por dia.
  valor      numeric(14,2) not null default 0 check (valor >= 0),
  observacao text,

  criado_em     timestamptz not null default now(),
  criado_por    uuid references auth.users(id) on delete set null,
  atualizado_em timestamptz not null default now(),

  -- A mesma categoria duas vezes no mesmo projeto faria o total do projeto
  -- depender de qual das duas linhas alguém abriu.
  constraint projeto_gastos_categoria_unica unique (projeto_id, categoria)
);

create index if not exists projeto_gastos_projeto_idx
  on public.projeto_gastos_previstos (projeto_id);

comment on table public.projeto_gastos_previstos is
  'Gasto PREVISTO do projeto, por categoria, em valor total (não por dia). A Direção cadastra; quem vê é quem pode_ver_valores().';

alter table public.projeto_gastos_previstos enable row level security;

drop policy if exists "gastos previstos: quem vê valor consulta" on public.projeto_gastos_previstos;
drop policy if exists "gastos previstos: só a Direção cadastra"  on public.projeto_gastos_previstos;
drop policy if exists "gastos previstos: só a Direção edita"     on public.projeto_gastos_previstos;
drop policy if exists "gastos previstos: só a Direção exclui"    on public.projeto_gastos_previstos;

-- Dinheiro do projeto não é dado de navegação: quem não é líder,
-- administrativo, financeiro ou Direção não lê a linha — e não é a tela
-- que decide isso, é esta política.
create policy "gastos previstos: quem vê valor consulta" on public.projeto_gastos_previstos
  for select to authenticated using (public.pode_ver_valores());

create policy "gastos previstos: só a Direção cadastra" on public.projeto_gastos_previstos
  for insert to authenticated with check (public.eh_direcao());

create policy "gastos previstos: só a Direção edita" on public.projeto_gastos_previstos
  for update to authenticated using (public.eh_direcao()) with check (public.eh_direcao());

create policy "gastos previstos: só a Direção exclui" on public.projeto_gastos_previstos
  for delete to authenticated using (public.eh_direcao());

create or replace function public.projeto_gastos_antes_de_gravar()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.criado_por := coalesce(new.criado_por, (select auth.uid()));
  else
    new.criado_em  := old.criado_em;
    new.criado_por := old.criado_por;
  end if;
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists projeto_gastos_antes_de_gravar on public.projeto_gastos_previstos;
create trigger projeto_gastos_antes_de_gravar
  before insert or update on public.projeto_gastos_previstos
  for each row execute function public.projeto_gastos_antes_de_gravar();


-- ═══════════════════════════════════════════════════════════════════════
--  6. AVARIA É GASTO DO PROJETO
--
--  A avaria já tinha custo; ele só não entrava em conta nenhuma. Agora
--  soma no REAL da solicitação, em coluna própria — e não dentro de
--  `real_outros`, que é digitado por gente: o cálculo sobrescreveria o que
--  a pessoa escreveu, ou a pessoa sobrescreveria a avaria.
--
--  Custo = `custo_real` quando fechado, `custo_estimado` enquanto não. É a
--  mesma regra que o painel já usava.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.solicitacoes
  add column if not exists real_avaria numeric(14,2) not null default 0;

comment on column public.solicitacoes.real_avaria is
  'Soma do custo das avarias desta solicitação (custo_real, ou custo_estimado enquanto não fechada). CALCULADA por trigger — nunca enviada pelo aplicativo. Entra no real_total.';

create or replace function public.solicitacao_recalcular_avaria(p_solicitacao uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_total numeric(14,2);
begin
  if p_solicitacao is null then return; end if;

  select coalesce(sum(coalesce(a.custo_real, a.custo_estimado, 0)), 0)
    into v_total
    from public.solicitacao_avarias a
   where a.solicitacao_id = p_solicitacao;

  -- A chave avisa ao trigger do cabeçalho que é o recálculo falando, e não
  -- alguém tentando digitar o custo da avaria à mão.
  perform set_config('campo.avaria', 'on', true);
  update public.solicitacoes
     set real_avaria = v_total
   where id = p_solicitacao
     and real_avaria is distinct from v_total;
  perform set_config('campo.avaria', 'off', true);
end;
$$;

create or replace function public.solicitacao_avarias_recalcula()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.solicitacao_recalcular_avaria(old.solicitacao_id);
    return old;
  end if;

  perform public.solicitacao_recalcular_avaria(new.solicitacao_id);
  -- Avaria movida de solicitação: as DUAS mudam de total.
  if tg_op = 'UPDATE' and new.solicitacao_id is distinct from old.solicitacao_id then
    perform public.solicitacao_recalcular_avaria(old.solicitacao_id);
  end if;
  return new;
end;
$$;

drop trigger if exists solicitacao_avarias_recalcula on public.solicitacao_avarias;
create trigger solicitacao_avarias_recalcula
  after insert or update or delete on public.solicitacao_avarias
  for each row execute function public.solicitacao_avarias_recalcula();


-- ═══════════════════════════════════════════════════════════════════════
--  7. O TRIGGER DO CABEÇALHO, COM AVARIA NO REAL E SST EM UMA MARCA
--
--  Reescreve `solicitacoes_antes_de_gravar` de 04_direcao_e_aprovacao.sql.
--  Todo o resto do corpo é idêntico — o que muda são três coisas:
--
--   · `real_avaria` entra em `v_real`, e com isso no total, no desvio e no
--     status de curso;
--   · `real_avaria` é BLINDADA contra escrita direta: só o recálculo
--     (que acende `campo.avaria`) muda o valor;
--   · SST vira uma marca. Não há mais seis conferências para fechar, então
--     não há mais como ficar "Pendente": se aplica → `Conforme`; não se
--     aplica → `Não aplicável`.
-- ═══════════════════════════════════════════════════════════════════════
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

    -- Projeto que não está Ativo não recebe campo NOVO. Stand By é pausa,
    -- Cancelado e Finalizado são fim — abrir campo em qualquer um dos três
    -- é gastar num projeto que a Direção já parou. Os campos JÁ ABERTOS
    -- seguem até o fim: a trava é só no insert.
    if exists (select 1 from public.projetos pr
                where pr.id = new.projeto_id and pr.situacao <> 'Ativo') then
      raise exception 'O projeto escolhido não está Ativo (está %). Só projeto Ativo aceita solicitação nova.',
        (select pr.situacao from public.projetos pr where pr.id = new.projeto_id);
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

    -- Avaria nasce zerada: não existe avaria antes de o campo sair.
    new.real_avaria := 0;
  else
    new.codigo           := old.codigo;
    new.criado_em        := old.criado_em;
    new.solicitante_id   := old.solicitante_id;
    new.solicitante_nome := old.solicitante_nome;

    -- Custo de avaria é CALCULADO. Só o recálculo o muda; qualquer outra
    -- escrita é descartada em silêncio, do mesmo jeito que `codigo` acima.
    if coalesce(current_setting('campo.avaria', true), '') <> 'on' then
      new.real_avaria := old.real_avaria;
    end if;

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
  -- A AVARIA entra no real — é gasto do projeto como qualquer outro, e
  -- deixá-la fora era o que fazia um campo com medidor quebrado aparecer
  -- "dentro do previsto".
  v_prev := coalesce(new.previsto_veiculo, 0) + coalesce(new.previsto_hospedagem, 0)
          + coalesce(new.previsto_alimentacao, 0) + coalesce(new.previsto_outros, 0);
  v_real := coalesce(new.real_veiculo, 0) + coalesce(new.real_hospedagem, 0)
          + coalesce(new.real_alimentacao, 0) + coalesce(new.real_outros, 0)
          + coalesce(new.real_avaria, 0);

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

  -- SST é UMA MARCA. As seis conferências saíram da tela, então não há
  -- mais meia conferência: quem marca "se aplica" está afirmando que o
  -- campo está conforme para SST.
  new.sst_identificacao := case
    when new.sst_aplicavel then 'Conforme'
    else 'Não aplicável'
  end;

  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists solicitacoes_antes_de_gravar on public.solicitacoes;
create trigger solicitacoes_antes_de_gravar
  before insert or update on public.solicitacoes
  for each row execute function public.solicitacoes_antes_de_gravar();

-- Alinha o que já está gravado: recalcula avaria (o que também refaz
-- totais, desvio, curso e SST em cada linha tocada).
do $$
declare r record;
begin
  for r in select distinct solicitacao_id from public.solicitacao_avarias loop
    perform public.solicitacao_recalcular_avaria(r.solicitacao_id);
  end loop;
end $$;

-- E realinha o SST de quem NÃO tem avaria (o recálculo acima não passou
-- por essas linhas). `where` para não reescrever a tabela inteira.
update public.solicitacoes
   set sst_identificacao = case when sst_aplicavel then 'Conforme' else 'Não aplicável' end
 where sst_identificacao is distinct from
       (case when sst_aplicavel then 'Conforme' else 'Não aplicável' end);


-- ═══════════════════════════════════════════════════════════════════════
--  8. FECHA O `execute` DAS FUNÇÕES NOVAS
--
--  Toda função em `public` entra no PostgREST como `/rest/v1/rpc/<nome>`, e
--  `grant execute` vem de graça pelo papel PUBLIC. Sem revogar, três coisas
--  ficariam chamáveis de fora:
--
--   · as TRÊS funções de trigger, que não têm o que fazer fora de um
--     trigger (chamada solta só daria erro, mas superfície exposta que não
--     serve a nada é superfície a menos que se queira);
--   · `solicitacao_recalcular_avaria`, que é `security definer` e ESCREVE
--     em `solicitacoes` passando por cima da RLS. Ela só recalcula a partir
--     das avarias reais — não dá para injetar valor falso por ela — mas
--     escrita que ignora RLS não fica ao alcance de quem quiser chamar;
--   · `pode_ver_valores`, revogada de `public` mas não de `anon` —
--     `revoke from public` não alcança um grant direto ao papel.
--
--  É o mesmo cuidado que 04_direcao_e_aprovacao.sql toma com `eh_direcao()`
--  e `eh_gestor()`. O linter do Supabase (0028/0029) cobra exatamente isto.
-- ═══════════════════════════════════════════════════════════════════════

-- Funções de trigger: ninguém chama de fora. O trigger executa como dono da
-- tabela e não depende destes grants.
revoke all on function public.solicitacao_avarias_recalcula()  from public, anon, authenticated;
revoke all on function public.projeto_gastos_antes_de_gravar() from public, anon, authenticated;
revoke all on function public.projetos_situacao_sincroniza()   from public, anon, authenticated;

-- Escreve em `solicitacoes` por cima da RLS: só o trigger a usa, e ele a
-- alcança porque roda como dono, não por grant.
revoke all on function public.solicitacao_recalcular_avaria(uuid) from public, anon, authenticated;

-- Quem não entrou não pergunta nada sobre valor.
revoke all    on function public.pode_ver_valores() from public, anon;
grant  execute on function public.pode_ver_valores() to authenticated;

comment on function public.solicitacao_recalcular_avaria(uuid) is
  'Recalcula solicitacoes.real_avaria a partir de solicitacao_avarias. USO INTERNO: chamada só pelo trigger solicitacao_avarias_recalcula. Sem execute para anon/authenticated.';


-- ═══════════════════════════════════════════════════════════════════════
--  CONFERÊNCIA — rode e leia. Tudo `true` / preenchido é a migração inteira
--  no lugar.
-- ═══════════════════════════════════════════════════════════════════════
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'projetos'
      and column_name in ('data_inicio', 'data_fim', 'escopo', 'situacao')) = 4
    as projetos_com_as_quatro_colunas,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'solicitacoes'
      and column_name = 'real_avaria') = 1                as solicitacoes_com_real_avaria,
  to_regclass('public.projeto_gastos_previstos') is not null as tabela_de_gastos_criada,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'projeto_gastos_previstos') as politicas_dos_gastos,
  (select count(*) from public.perfis where papel in ('administrativo', 'financeiro'))
    as acessos_nos_papeis_novos;

-- Situação dos projetos, para conferir a conversão do booleano:
select situacao, count(*) from public.projetos group by situacao order by situacao;
