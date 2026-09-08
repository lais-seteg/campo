-- ═══════════════════════════════════════════════════════════════════════
--  SOLICITAÇÃO DE CAMPO · Seteg — Schema + Segurança (Supabase/Postgres)
--
--  ⚠ RODE 02_campo_v2.sql DEPOIS DESTE. A v2 muda coisas que estão
--    escritas aqui embaixo e que já não valem mais:
--
--      · o fluxo de status — a aprovação saiu, e o trigger que a exigia
--        é substituído (hoje: Solicitada → Logística confirmada →
--        Em campo → Finalizada, ou Cancelada com motivo);
--      · as colunas de aprovação (aprovado_por, aprovado_em,
--        motivo_recusa), que a v2 remove depois de migrar o conteúdo;
--      · a integração com o estoque, que a v2 implementa de verdade —
--        reserva por período, Saída na entrega, Entrada na devolução.
--
--    Este arquivo continua sendo a base: é ele que cria as tabelas do
--    formulário. Só não é mais a palavra final sobre o fluxo.
--
--  Ele traduz o formulário
--  doc/FORMULARIO_SOLICITACAO_ADMINISTRATIVA_FINANCEIRA_CODIGO
--  CLOCKIFY_REV00.xlsx para tabelas, e é o que o script.js desta pasta
--  espera encontrar. Rode no MESMO projeto Supabase do Controle de
--  Estoque: `perfis`, `identificar_acesso()`, `eh_gestor()`,
--  `eh_usuario_ativo()` e `itens` vêm de lá (estoque/supabase/01_schema.sql)
--  e NÃO são recriados aqui.
--
--  Princípios herdados do outro sistema:
--   1. RLS ligada em todas as tabelas; `anon` não enxerga nada.
--   2. Quem manda é `perfis`: sem perfil ativo, ninguém acessa dado algum.
--   3. Só admin (Gestão) aprova, recusa e exclui.
--   4. Autoria e datas são carimbadas por trigger, não pelo aplicativo.
--   5. O código (SC-0001) vem de sequence — dois pedidos simultâneos não
--      recebem o mesmo número.
--
--  O QUE AINDA FALTA (a combinar quando a integração for implementada):
--  as funções que movimentam o estoque na conferência —
--  `baixar_para_solicitacao()` na entrega e `retornar_de_solicitacao()`
--  na devolução, mais a abertura de manutenção quando houver avaria. Ver
--  o comentário da seção CONFERÊNCIA no script.js.
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- ═══════════════════════════════════════════════════════════════════════
--  1. SOLICITAÇÕES — o cabeçalho comum às duas abas do formulário
-- ═══════════════════════════════════════════════════════════════════════
create sequence if not exists public.solicitacoes_codigo_seq;

create table if not exists public.solicitacoes (
  id     uuid primary key default gen_random_uuid(),
  codigo text not null unique
         default 'SC-' || lpad(nextval('public.solicitacoes_codigo_seq')::text, 4, '0'),

  -- Administrativo = veículo/hospedagem/equipamento (aba ADMINISTRATIVO).
  -- Financeiro     = despesas e diárias (aba FINANCEIRO).
  tipo   text not null check (tipo in ('Administrativo', 'Financeiro')),

  solicitante_id   uuid references auth.users(id) on delete set null,
  solicitante_nome text not null,
  setor            text not null,

  -- "Data para receber o recurso" do papel; a data da solicitação é o
  -- próprio criado_em.
  data_recurso     date,
  cliente_projeto  text not null,
  codigo_clockify  text,
  destino          text,
  periodo_inicio   date,
  periodo_fim      date,
  observacao       text,

  -- ── Bloco 1 do formulário administrativo: veículo ──
  veiculo_necessario     boolean not null default false,
  veiculo_condutor       text,
  veiculo_cpf            text,
  veiculo_descricao      text,
  veiculo_local_retirada text,
  veiculo_data_retirada  date,
  veiculo_hora_retirada  text,
  veiculo_local_entrega  text,
  veiculo_data_entrega   date,
  veiculo_hora_entrega   text,

  -- ── Bloco 2: hospedagem ──
  -- As cidades ficam em solicitacao_hospedagens (uma linha por trecho):
  -- campo que passa por mais de uma base dorme em mais de um lugar.
  hospedagem_necessaria boolean not null default false,

  -- ── Financeiro: para onde o dinheiro vai ──
  dados_transferencia text,

  -- ── Fluxo ──
  status text not null default 'Pendente'
         check (status in ('Pendente', 'Aprovada', 'Em campo', 'Concluída', 'Recusada', 'Cancelada')),
  motivo_recusa text,
  aprovado_por  uuid references auth.users(id) on delete set null,
  aprovado_em   timestamptz,

  -- ── Quadro CONFERÊNCIA do papel: as duas datas e as quatro assinaturas ──
  entrega_data        date,
  entrega_adm         text,
  entrega_prestador   text,
  devolucao_data      date,
  devolucao_adm       text,
  devolucao_prestador text,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  -- Recusar sem dizer por quê deixa o solicitante sem resposta.
  constraint solicitacoes_recusa_check check (
    status <> 'Recusada' or length(btrim(coalesce(motivo_recusa, ''))) > 0
  ),
  -- Veículo marcado exige condutor: é quem assume o carro.
  constraint solicitacoes_veiculo_check check (
    veiculo_necessario is false or length(btrim(coalesce(veiculo_condutor, ''))) > 0
  ),
  constraint solicitacoes_periodo_check check (
    periodo_inicio is null or periodo_fim is null or periodo_fim >= periodo_inicio
  ),
  constraint solicitacoes_conferencia_check check (
    devolucao_data is null or entrega_data is not null
  )
);

create index if not exists solicitacoes_status_idx  on public.solicitacoes (status, criado_em desc);
create index if not exists solicitacoes_autor_idx   on public.solicitacoes (solicitante_id, criado_em desc);


-- ═══════════════════════════════════════════════════════════════════════
--  2. EQUIPAMENTOS — bloco 3 do formulário administrativo
--
--  `item_id` aponta para o catálogo do Controle de Estoque. É ESTE
--  vínculo que vai permitir a baixa e o retorno automáticos: equipamento
--  de campo é empréstimo, sai na entrega e volta na devolução.
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.solicitacao_equipamentos (
  id             uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes(id) on delete cascade,
  item_id        uuid references public.itens(id) on delete restrict,
  -- Texto livre só para o que ainda não existe no catálogo; o caminho
  -- normal é item_id preenchido.
  descricao      text,
  quantidade     integer not null default 1 check (quantidade > 0),

  -- Quadro de conferência, coluna por coluna: ENT. · TESTE · DEV. · TESTE
  -- · AVARIA?
  entregue        boolean not null default false,
  teste_entrega   boolean not null default false,
  devolvido       boolean not null default false,
  teste_devolucao boolean not null default false,
  avaria          boolean not null default false,
  avaria_obs      text,

  constraint solicitacao_equip_identificacao_check check (
    item_id is not null or length(btrim(coalesce(descricao, ''))) > 0
  )
);
create index if not exists solicitacao_equip_idx on public.solicitacao_equipamentos (solicitacao_id);
create index if not exists solicitacao_equip_item_idx on public.solicitacao_equipamentos (item_id);


-- ═══════════════════════════════════════════════════════════════════════
--  3. HOSPEDAGENS — bloco 2 do formulário administrativo
--
--  Uma linha por cidade. Os dias são calculados na tela a partir de
--  entrada e saída; a checagem abaixo garante que ninguém grave saída
--  anterior à entrada por SQL direto.
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.solicitacao_hospedagens (
  id             uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes(id) on delete cascade,
  cidade         text not null,
  entrada        date,
  saida          date,
  dias           integer check (dias is null or dias >= 0),
  constraint solicitacao_hospedagens_periodo_check check (
    entrada is null or saida is null or saida >= entrada
  )
);
create index if not exists solicitacao_hosp_idx on public.solicitacao_hospedagens (solicitacao_id);


-- ═══════════════════════════════════════════════════════════════════════
--  4. DESPESAS — "valor com necessidade de prestação de contas"
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.solicitacao_despesas (
  id             uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes(id) on delete cascade,
  grupo          text not null check (grupo in ('Transporte', 'Combustível', 'Outros')),
  descricao      text,
  valor          numeric(14,2) not null default 0 check (valor >= 0)
);
create index if not exists solicitacao_despesas_idx on public.solicitacao_despesas (solicitacao_id);


-- ═══════════════════════════════════════════════════════════════════════
--  5. DIÁRIAS — "valor sem prestação de contas", pago mediante recibo
--
--  Os nomes das diárias são os da planilha; mudar um nome aqui é mudar o
--  que o formulário oferece (ver DIARIAS no script.js).
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.solicitacao_diarias (
  id             uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes(id) on delete cascade,
  colaborador    text not null,
  vinculo        text not null check (vinculo in ('Seteg', 'Temporário')),
  tipo_diaria    text not null,
  dias           integer not null default 0 check (dias >= 0),
  valor_unitario numeric(14,2) not null default 0 check (valor_unitario >= 0),
  -- Coluna gerada: o "VALOR A TRANSFERIR" da planilha nunca diverge do
  -- que foi digitado, nem por SQL direto.
  valor_total    numeric(14,2) generated always as (dias * valor_unitario) stored,
  dados_bancarios text
);
create index if not exists solicitacao_diarias_idx on public.solicitacao_diarias (solicitacao_id);


-- ═══════════════════════════════════════════════════════════════════════
--  6. TRIGGERS — autoria e datas não são assunto do aplicativo
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.solicitacoes_antes_de_gravar()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.solicitante_id   := (select auth.uid());
    new.solicitante_nome := coalesce(public.nome_atual(), new.solicitante_nome);
    new.status           := 'Pendente';   -- ninguém nasce aprovado
  else
    new.codigo    := old.codigo;          -- o código nunca muda
    new.criado_em := old.criado_em;
    -- Aprovar é da Gestão: sem isso, um operador poderia dar update no
    -- próprio pedido e liberar o recurso.
    if new.status is distinct from old.status
       and new.status in ('Aprovada', 'Recusada')
       and not public.eh_gestor() then
      raise exception 'Só a Gestão aprova ou recusa solicitações.';
    end if;
    if new.status = 'Aprovada' and old.status <> 'Aprovada' then
      new.aprovado_por := (select auth.uid());
      new.aprovado_em  := now();
    end if;
  end if;
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists solicitacoes_antes_de_gravar on public.solicitacoes;
create trigger solicitacoes_antes_de_gravar
  before insert or update on public.solicitacoes
  for each row execute function public.solicitacoes_antes_de_gravar();


-- ═══════════════════════════════════════════════════════════════════════
--  7. RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.solicitacoes             enable row level security;
alter table public.solicitacao_equipamentos enable row level security;
alter table public.solicitacao_hospedagens  enable row level security;
alter table public.solicitacao_despesas     enable row level security;
alter table public.solicitacao_diarias      enable row level security;

-- ── solicitações ──
drop policy if exists "solicitações: usuário ativo consulta" on public.solicitacoes;
create policy "solicitações: usuário ativo consulta" on public.solicitacoes
  for select to authenticated
  using (public.eh_usuario_ativo());

drop policy if exists "solicitações: usuário ativo abre" on public.solicitacoes;
create policy "solicitações: usuário ativo abre" on public.solicitacoes
  for insert to authenticated
  with check (public.eh_usuario_ativo());

-- O trigger acima é que barra a aprovação por quem não é da Gestão; a
-- política deixa o operador editar o próprio pedido e o administrativo
-- registrar a conferência.
drop policy if exists "solicitações: usuário ativo atualiza" on public.solicitacoes;
create policy "solicitações: usuário ativo atualiza" on public.solicitacoes
  for update to authenticated
  using (public.eh_usuario_ativo())
  with check (public.eh_usuario_ativo());

drop policy if exists "solicitações: só Gestão exclui" on public.solicitacoes;
create policy "solicitações: só Gestão exclui" on public.solicitacoes
  for delete to authenticated
  using (public.eh_gestor());

-- ── linhas filhas: mesma regra para as três ──
do $$
declare t text;
begin
  foreach t in array array['solicitacao_equipamentos', 'solicitacao_hospedagens',
                           'solicitacao_despesas', 'solicitacao_diarias'] loop
    execute format('drop policy if exists "%s: usuário ativo consulta" on public.%I', t, t);
    execute format('create policy "%s: usuário ativo consulta" on public.%I
                      for select to authenticated using (public.eh_usuario_ativo())', t, t);
    execute format('drop policy if exists "%s: usuário ativo grava" on public.%I', t, t);
    execute format('create policy "%s: usuário ativo grava" on public.%I
                      for all to authenticated
                      using (public.eh_usuario_ativo())
                      with check (public.eh_usuario_ativo())', t, t);
  end loop;
end $$;

grant usage on sequence public.solicitacoes_codigo_seq to authenticated;

commit;
