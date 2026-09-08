-- ═══════════════════════════════════════════════════════════════════════
--  SOLICITAÇÃO DE CAMPO · Seteg — v2: LOGÍSTICA, CUSTO E INTEGRAÇÃO
--
--  Rode DEPOIS de 01_solicitacoes.sql, no mesmo projeto Supabase do
--  Controle de Estoque. O arquivo é idempotente: pode rodar de novo sem
--  duplicar nada.
--
--  O que esta migração faz, em uma frase cada:
--
--   1. FLUXO        — a aprovação sai. Solicitada → Logística confirmada
--                     → Em campo → Finalizada (ou Cancelada, com motivo).
--   2. PROJETOS     — cadastro com a diária PREVISTA que o líder informa
--                     (aluguel de veículo e diária de hotel).
--   3. HOTÉIS       — cadastro de hotéis e pousadas por município.
--   4. DIÁRIAS      — tabela de valores de referência: R$ 55,00 com
--                     pernoite e R$ 35,00 sem pernoite.
--   5. EQUIPE       — quem vai a campo, para o calendário cruzar equipe ×
--                     projeto × data.
--   6. TRANSPORTE   — valor REAL, com a locadora (Movida, Localiza,
--                     Unidas, Outros).
--   7. PREVISTO×REAL— quatro previstos, quatro reais, e o STATUS DE CURSO
--                     (abaixo / dentro / acima do previsto).
--   8. SST          — bloco de conferência de segurança na solicitação,
--                     com a lista de EPIs levados e a identificação
--                     (Conforme / Pendente / Não aplicável).
--   9. RESERVA      — o material solicitado fica INDISPONÍVEL nas datas do
--                     campo. É a integração com o estoque: reserva por
--                     período na solicitação, Saída na entrega, Entrada na
--                     devolução, manutenção aberta quando há avaria.
--  10. AVARIAS      — relatório de avaria com custo (estimado e real).
--  11. ASSINATURAS  — assinatura digital do checklist, desenhada na tela.
--  12. HISTÓRICO    — toda edição e todo acréscimo ficam registrados.
--
--  Continua valendo o que veio do estoque: RLS em tudo, `anon` não vê
--  nada, autoria carimbada por trigger e nunca pelo aplicativo.
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- ═══════════════════════════════════════════════════════════════════════
--  1. FLUXO — a aprovação sai de cena
--
--  O pedido de campo não espera despacho: quem abre já abre valendo. O
--  que existe depois é confirmação de LOGÍSTICA (o administrativo fechou
--  veículo, hotel e equipamento), e não autorização de gasto.
--
--  A ordem aqui importa: primeiro afrouxa a checagem antiga, depois
--  traduz os valores gravados, e só então aperta na lista nova. Fazer o
--  contrário quebraria em banco que já tem linha.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.solicitacoes drop constraint if exists solicitacoes_status_check;
alter table public.solicitacoes drop constraint if exists solicitacoes_recusa_check;
alter table public.solicitacoes drop constraint if exists solicitacoes_cancelamento_check;

alter table public.solicitacoes add column if not exists motivo_cancelamento text;
alter table public.solicitacoes add column if not exists cancelado_por uuid references auth.users(id) on delete set null;
alter table public.solicitacoes add column if not exists cancelado_em  timestamptz;
alter table public.solicitacoes add column if not exists logistica_por uuid references auth.users(id) on delete set null;
alter table public.solicitacoes add column if not exists logistica_em  timestamptz;
alter table public.solicitacoes add column if not exists logistica_obs text;

-- O motivo da recusa vira motivo do cancelamento: do ponto de vista de
-- quem pediu é o mesmo campo — por que este pedido não vai acontecer.
update public.solicitacoes
   set motivo_cancelamento = coalesce(motivo_cancelamento, motivo_recusa)
 where motivo_recusa is not null;

update public.solicitacoes set status = 'Solicitada'           where status = 'Pendente';
update public.solicitacoes set status = 'Logística confirmada' where status = 'Aprovada';
update public.solicitacoes set status = 'Finalizada'           where status = 'Concluída';
update public.solicitacoes set status = 'Cancelada'            where status = 'Recusada';

alter table public.solicitacoes alter column status set default 'Solicitada';
alter table public.solicitacoes add constraint solicitacoes_status_check check (
  status in ('Solicitada', 'Logística confirmada', 'Em campo', 'Finalizada', 'Cancelada')
);
-- Cancelar sem dizer por quê deixa quem pediu sem resposta — mesma regra
-- que a recusa tinha.
alter table public.solicitacoes add constraint solicitacoes_cancelamento_check check (
  status <> 'Cancelada' or length(btrim(coalesce(motivo_cancelamento, ''))) > 0
);

comment on column public.solicitacoes.status is
  'Solicitada → Logística confirmada → Em campo → Finalizada. Cancelada a qualquer momento, com motivo. Não existe aprovação: o pedido de campo nasce valendo.';


-- ═══════════════════════════════════════════════════════════════════════
--  2. PROJETOS — a diária PREVISTA por projeto
--
--  Quem informa é o líder, e informa duas coisas: quanto custa por dia o
--  aluguel do veículo e quanto custa por dia a diária de hotel naquele
--  campo. É deste cadastro que sai o PREVISTO de cada solicitação — a
--  pessoa não redigita o orçamento a cada viagem.
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.projetos (
  id      uuid primary key default gen_random_uuid(),
  nome    text not null check (length(btrim(nome)) > 0),
  cliente text not null check (length(btrim(cliente)) > 0),
  codigo_clockify text,
  lider   text,

  -- Os três previstos POR DIA. Multiplicados pelos dias do campo (e pelo
  -- tamanho da equipe, no caso da alimentação) formam o previsto da
  -- solicitação.
  previsto_veiculo_dia     numeric(14,2) not null default 0 check (previsto_veiculo_dia     >= 0),
  previsto_hotel_dia       numeric(14,2) not null default 0 check (previsto_hotel_dia       >= 0),
  previsto_alimentacao_dia numeric(14,2) not null default 0 check (previsto_alimentacao_dia >= 0),

  observacao text,
  ativo      boolean not null default true,

  criado_em     timestamptz not null default now(),
  criado_por    uuid references auth.users(id) on delete set null,
  atualizado_em timestamptz not null default now(),

  -- O mesmo projeto do mesmo cliente não entra duas vezes: senão o
  -- previsto de um campo sairia de um cadastro e o do campo seguinte do
  -- cadastro duplicado, e a comparação com o real perderia sentido.
  constraint projetos_unico unique (cliente, nome)
);
create index if not exists projetos_ativo_idx on public.projetos (ativo, cliente, nome);

comment on table public.projetos is
  'Projetos de campo e o previsto por dia que o líder informa. É a base do previsto × real de cada solicitação.';


-- ═══════════════════════════════════════════════════════════════════════
--  3. HOTÉIS E POUSADAS POR MUNICÍPIO
--
--  Campo em cidade pequena repete hospedagem: o cadastro existe para não
--  procurar hotel de novo a cada viagem, e para o previsto da diária sair
--  de um valor combinado, não de estimativa de memória.
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.hoteis (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null check (length(btrim(nome)) > 0),
  tipo      text not null default 'Hotel'
            check (tipo in ('Hotel', 'Pousada', 'Flat', 'Apart-hotel', 'Hostel', 'Outro')),
  municipio text not null check (length(btrim(municipio)) > 0),
  uf        text not null check (uf ~ '^[A-Z]{2}$'),

  endereco     text,
  bairro       text,
  telefone     text,
  whatsapp     text,
  email        text,
  contato_nome text,

  valor_diaria       numeric(14,2) not null default 0 check (valor_diaria >= 0),
  cafe_incluso       boolean not null default false,
  estacionamento     boolean not null default false,
  aceita_faturamento boolean not null default false,

  observacao text,
  ativo      boolean not null default true,

  criado_em     timestamptz not null default now(),
  criado_por    uuid references auth.users(id) on delete set null,
  atualizado_em timestamptz not null default now(),

  constraint hoteis_unico unique (nome, municipio, uf)
);
create index if not exists hoteis_municipio_idx on public.hoteis (uf, municipio, nome);
create index if not exists hoteis_ativo_idx     on public.hoteis (ativo);

comment on table public.hoteis is
  'Hotéis e pousadas por município. O valor_diaria é o combinado com a casa e alimenta o previsto de hospedagem.';

-- A hospedagem da solicitação passa a apontar para o cadastro e guarda
-- previsto e real lado a lado.
alter table public.solicitacao_hospedagens add column if not exists hotel_id uuid references public.hoteis(id) on delete set null;
alter table public.solicitacao_hospedagens add column if not exists diaria_prevista numeric(14,2) not null default 0;
alter table public.solicitacao_hospedagens add column if not exists diaria_real     numeric(14,2);
alter table public.solicitacao_hospedagens add column if not exists reserva_codigo  text;
create index if not exists solicitacao_hosp_hotel_idx on public.solicitacao_hospedagens (hotel_id);


-- ═══════════════════════════════════════════════════════════════════════
--  4. DIÁRIAS — os valores de referência
--
--  R$ 55,00 com pernoite e R$ 35,00 sem pernoite. Fica em tabela, e não
--  no código do navegador, por dois motivos: mudar o valor é decisão
--  administrativa e não deploy, e o valor de referência precisa estar ao
--  lado do valor efetivamente pago para a diferença aparecer.
--
--  Os nomes são os da planilha — mudar um nome aqui muda o que o
--  formulário oferece.
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.diaria_valores (
  id          uuid primary key default gen_random_uuid(),
  tipo_diaria text not null unique,
  vinculo     text not null check (vinculo in ('Seteg', 'Temporário')),
  pernoite    boolean not null,
  valor       numeric(14,2) not null check (valor >= 0),
  ativo       boolean not null default true,
  atualizado_em timestamptz not null default now()
);

insert into public.diaria_valores (tipo_diaria, vinculo, pernoite, valor) values
  ('Diária sem pernoite | SEG À SEX',            'Seteg',      false, 35.00),
  ('Diária sem pernoite | SAB À DOM',            'Seteg',      false, 35.00),
  ('Diária com pernoite',                        'Seteg',      true,  55.00),
  ('Diária colaborador temporário sem pernoite', 'Temporário', false, 35.00),
  ('Diária colaborador temporário com pernoite', 'Temporário', true,  55.00)
on conflict (tipo_diaria) do nothing;

comment on table public.diaria_valores is
  'Valores de referência da diária de alimentação: R$ 55,00 com pernoite, R$ 35,00 sem. Alterar aqui muda o que o formulário sugere, sem mexer no código.';


-- ═══════════════════════════════════════════════════════════════════════
--  5. EQUIPE — quem vai a campo
--
--  O calendário precisa de três coisas: equipe, projeto e data. Projeto e
--  data já estavam na solicitação; a equipe é esta tabela. Sem ela o
--  calendário mostraria pedidos, não pessoas — e o que a coordenação
--  precisa saber é quem está onde.
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.solicitacao_equipe (
  id             uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes(id) on delete cascade,
  colaborador    text not null check (length(btrim(colaborador)) > 0),
  funcao         text,
  codigo_clockify text,
  vinculo        text not null default 'Seteg' check (vinculo in ('Seteg', 'Temporário')),
  -- O líder é quem informa o previsto e assina como prestador. Um por
  -- solicitação, garantido pelo índice único parcial abaixo.
  lider          boolean not null default false,
  telefone       text,

  constraint solicitacao_equipe_unica unique (solicitacao_id, colaborador)
);
create index if not exists solicitacao_equipe_idx on public.solicitacao_equipe (solicitacao_id);
create unique index if not exists solicitacao_equipe_um_lider
  on public.solicitacao_equipe (solicitacao_id) where lider;

comment on table public.solicitacao_equipe is
  'Quem vai a campo nesta solicitação. Alimenta o calendário (equipe × projeto × data) e o previsto de alimentação.';


-- ═══════════════════════════════════════════════════════════════════════
--  6. TRANSPORTE — o valor REAL, com a locadora
--
--  O papel só perguntava "qual veículo". Quem paga a fatura precisa saber
--  de quem foi a locação e quanto ela custou de verdade — a locadora
--  entra em lista fechada porque é sobre ela que se negocia contrato.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.solicitacoes add column if not exists transporte_modalidade text;
alter table public.solicitacoes add column if not exists transporte_locadora   text;
alter table public.solicitacoes add column if not exists transporte_locadora_outra text;
alter table public.solicitacoes add column if not exists transporte_contrato   text;
alter table public.solicitacoes add column if not exists transporte_placa      text;

alter table public.solicitacoes drop constraint if exists solicitacoes_transporte_check;
alter table public.solicitacoes add constraint solicitacoes_transporte_check check (
  transporte_modalidade is null or transporte_modalidade in
    ('Locação', 'Frota própria', 'Aéreo', 'Rodoviário', 'Aplicativo', 'Outros')
);

alter table public.solicitacoes drop constraint if exists solicitacoes_locadora_check;
alter table public.solicitacoes add constraint solicitacoes_locadora_check check (
  transporte_locadora is null or transporte_locadora in ('Movida', 'Localiza', 'Unidas', 'Outros')
);

-- "Outros" sem dizer qual é o mesmo que não responder: o relatório de
-- gasto por locadora não conseguiria somar nada.
alter table public.solicitacoes drop constraint if exists solicitacoes_locadora_outra_check;
alter table public.solicitacoes add constraint solicitacoes_locadora_outra_check check (
  transporte_locadora is distinct from 'Outros'
  or length(btrim(coalesce(transporte_locadora_outra, ''))) > 0
);

comment on column public.solicitacoes.transporte_locadora is
  'Movida, Localiza, Unidas ou Outros. Com Outros, transporte_locadora_outra é obrigatória.';


-- ═══════════════════════════════════════════════════════════════════════
--  7. PREVISTO × REAL e o STATUS DE CURSO
--
--  Quatro previstos e quatro reais, nas mesmas quatro linhas: veículo,
--  hospedagem, alimentação e outros. Os totais, o desvio e o status de
--  curso são MANTIDOS POR TRIGGER e nunca digitados — igual ao Status e
--  ao Valor Total do estoque.
--
--  Por que trigger e não coluna gerada: coluna gerada no Postgres não
--  pode referenciar outra coluna gerada, e o status de curso é função dos
--  totais. Escrever a soma inteira dentro do CASE daria uma expressão de
--  quinze linhas onde qualquer ajuste futuro erraria em silêncio.
--
--  A FAIXA DE TOLERÂNCIA é 5%: gasto entre 95% e 105% do previsto é
--  "Dentro do previsto". Sem faixa, todo campo terminaria "acima" ou
--  "abaixo" por causa de um combustível de dez reais, e o indicador não
--  diria mais nada.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.solicitacoes add column if not exists projeto_id uuid references public.projetos(id) on delete set null;

alter table public.solicitacoes add column if not exists previsto_veiculo     numeric(14,2) not null default 0;
alter table public.solicitacoes add column if not exists previsto_hospedagem  numeric(14,2) not null default 0;
alter table public.solicitacoes add column if not exists previsto_alimentacao numeric(14,2) not null default 0;
alter table public.solicitacoes add column if not exists previsto_outros      numeric(14,2) not null default 0;

alter table public.solicitacoes add column if not exists real_veiculo     numeric(14,2) not null default 0;
alter table public.solicitacoes add column if not exists real_hospedagem  numeric(14,2) not null default 0;
alter table public.solicitacoes add column if not exists real_alimentacao numeric(14,2) not null default 0;
alter table public.solicitacoes add column if not exists real_outros      numeric(14,2) not null default 0;

alter table public.solicitacoes add column if not exists previsto_total numeric(14,2) not null default 0;
alter table public.solicitacoes add column if not exists real_total     numeric(14,2) not null default 0;
alter table public.solicitacoes add column if not exists desvio_valor   numeric(14,2) not null default 0;
-- Larga de propósito: previsto de R$ 0,01 com real de mil reais dá um
-- percentual de sete dígitos, e numeric(9,2) estouraria na hora de
-- gravar — derrubando o salvamento por causa de um previsto digitado
-- errado.
alter table public.solicitacoes add column if not exists desvio_percentual numeric(14,2);
alter table public.solicitacoes add column if not exists status_curso   text not null default 'Sem realizado';

alter table public.solicitacoes drop constraint if exists solicitacoes_status_curso_check;
alter table public.solicitacoes add constraint solicitacoes_status_curso_check check (
  status_curso in ('Sem previsto', 'Sem realizado', 'Abaixo do previsto',
                   'Dentro do previsto', 'Acima do previsto')
);

create index if not exists solicitacoes_projeto_idx on public.solicitacoes (projeto_id, criado_em desc);
create index if not exists solicitacoes_curso_idx   on public.solicitacoes (status_curso);
create index if not exists solicitacoes_periodo_idx on public.solicitacoes (periodo_inicio, periodo_fim);

comment on column public.solicitacoes.status_curso is
  'Abaixo / Dentro / Acima do previsto, com faixa de tolerância de 5%. Calculado por trigger a partir dos totais — nunca digitado.';


-- ═══════════════════════════════════════════════════════════════════════
--  8. SST — conferência de segurança na solicitação
--
--  Não é cadastro de pessoa: é a conferência que o líder faz antes de
--  sair, e que precisa aparecer no checklist assinado. A identificação
--  (Conforme / Pendente / Não aplicável) é calculada, para o painel poder
--  contar campo que saiu sem SST fechado.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.solicitacoes add column if not exists sst_aplicavel boolean not null default true;
alter table public.solicitacoes add column if not exists sst_apr_emitida          boolean not null default false;
alter table public.solicitacoes add column if not exists sst_pt_emitida           boolean not null default false;
alter table public.solicitacoes add column if not exists sst_dds_realizado        boolean not null default false;
alter table public.solicitacoes add column if not exists sst_treinamento_conferido boolean not null default false;
alter table public.solicitacoes add column if not exists sst_aso_conferido        boolean not null default false;
alter table public.solicitacoes add column if not exists sst_epi_conferido        boolean not null default false;
alter table public.solicitacoes add column if not exists sst_responsavel          text;
alter table public.solicitacoes add column if not exists sst_observacao           text;
alter table public.solicitacoes add column if not exists sst_identificacao        text not null default 'Pendente';

alter table public.solicitacoes drop constraint if exists solicitacoes_sst_check;
alter table public.solicitacoes add constraint solicitacoes_sst_check check (
  sst_identificacao in ('Conforme', 'Pendente', 'Não aplicável')
);
create index if not exists solicitacoes_sst_idx on public.solicitacoes (sst_identificacao);

-- Os EPIs que saem com a equipe. Uma linha por EPI, com quem conferiu.
create table if not exists public.solicitacao_sst_epis (
  id             uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes(id) on delete cascade,
  epi            text not null check (length(btrim(epi)) > 0),
  quantidade     integer not null default 1 check (quantidade > 0),
  conferido      boolean not null default false,
  ca             text,
  observacao     text,
  constraint solicitacao_sst_epi_unico unique (solicitacao_id, epi)
);
create index if not exists solicitacao_sst_epis_idx on public.solicitacao_sst_epis (solicitacao_id);

comment on table public.solicitacao_sst_epis is
  'EPIs que vão com a equipe nesta solicitação. Saem impressos no checklist para conferência na retirada.';

comment on column public.solicitacoes.sst_identificacao is
  'Conforme quando toda a conferência de SST está marcada; Pendente enquanto falta alguma; Não aplicável quando o campo não exige SST. Calculado por trigger.';


-- ═══════════════════════════════════════════════════════════════════════
--  9. RESERVA DE MATERIAL — a integração com o Controle de Estoque
--
--  A regra é: material pedido para campo fica INDISPONÍVEL nas datas
--  daquele campo. Não é baixa — é compromisso. Equipamento de campo é
--  empréstimo, e o formulário em papel já dizia isso ao ter entrega e
--  devolução; o saldo do estoque só muda quando o item fisicamente sai.
--
--    solicitação  → reserva no período (saldo do estoque não muda)
--    entrega      → Saída  no estoque, reserva vira 'Em campo'
--    devolução    → Entrada no estoque, reserva vira 'Devolvido'
--
--  Duas solicitações que se cruzam no calendário disputam o mesmo saldo:
--  quem reserva primeiro leva, e a segunda ouve o que falta e em que
--  datas. Por isso a conferência de saldo mora aqui e não no navegador —
--  duas pessoas salvando ao mesmo tempo não podem furar o estoque.
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.item_reservas (
  id       uuid primary key default gen_random_uuid(),
  item_id  uuid not null references public.itens(id) on delete restrict,
  solicitacao_id uuid not null references public.solicitacoes(id) on delete cascade,
  solicitacao_equipamento_id uuid references public.solicitacao_equipamentos(id) on delete cascade,
  quantidade integer not null check (quantidade > 0),

  -- O período do campo. Guardado na reserva, e não lido da solicitação a
  -- cada consulta, porque é ele que define a disputa: mudar o período da
  -- solicitação obriga a refazer a reserva, e é isso que se quer.
  inicio date not null,
  fim    date not null,

  situacao text not null default 'Reservado'
           check (situacao in ('Reservado', 'Em campo', 'Devolvido', 'Cancelada')),

  criado_em    timestamptz not null default now(),
  usuario_id   uuid references auth.users(id) on delete set null,
  usuario_nome text,
  baixado_em   timestamptz,
  devolvido_em timestamptz,

  constraint item_reservas_periodo_check check (fim >= inicio)
);
create index if not exists item_reservas_item_idx
  on public.item_reservas (item_id, inicio, fim) where situacao in ('Reservado', 'Em campo');
create index if not exists item_reservas_sol_idx on public.item_reservas (solicitacao_id);
create index if not exists item_reservas_equip_idx on public.item_reservas (solicitacao_equipamento_id);

comment on table public.item_reservas is
  'O que está comprometido de cada item do estoque, e em que datas. Reservado = pedido; Em campo = já saiu; Devolvido = voltou; Cancelada = pedido desfeito.';


-- Quanto de um item já está comprometido no período. É a conta que decide
-- se um novo pedido cabe: reserva que não encosta nas datas não disputa
-- nada, e por isso a sobreposição é inclusive nas duas pontas.
create or replace function public.item_comprometido(
  p_item uuid, p_inicio date, p_fim date, p_ignorar_solicitacao uuid default null)
returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(r.quantidade), 0)::integer
    from public.item_reservas r
   where r.item_id = p_item
     and r.situacao in ('Reservado', 'Em campo')
     and (p_ignorar_solicitacao is null or r.solicitacao_id <> p_ignorar_solicitacao)
     and r.inicio <= p_fim
     and r.fim    >= p_inicio
$$;

-- O catálogo visto pelas datas do campo: é isto que o formulário mostra
-- em "disponível no período", em vez do saldo cru do estoque (que não
-- sabe nada sobre datas). Item em manutenção não vai a campo, e por isso
-- entra na lista com disponível zero em vez de sumir — quem está pedindo
-- precisa saber por que não pode levar.
create or replace function public.itens_disponiveis_no_periodo(
  p_inicio date, p_fim date, p_ignorar_solicitacao uuid default null)
returns table (
  item_id uuid, codigo text, produto text, categoria text,
  estoque_atual integer, em_manutencao boolean,
  comprometido integer, disponivel integer)
language sql stable security definer set search_path = ''
as $$
  select i.id, i.codigo, i.produto, i.categoria, i.estoque_atual, i.em_manutencao,
         public.item_comprometido(i.id, p_inicio, p_fim, p_ignorar_solicitacao),
         case when i.em_manutencao then 0
              else greatest(i.estoque_atual
                     - public.item_comprometido(i.id, p_inicio, p_fim, p_ignorar_solicitacao), 0)
         end
    from public.itens i
   where public.eh_usuario_ativo()
   order by i.produto
$$;


-- Reserva (ou refaz) o material de uma solicitação. Idempotente: chamar
-- duas vezes deixa o mesmo resultado, porque a reserva ainda não baixada
-- é apagada e reescrita. O que já foi para campo é história e não se toca.
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
  if v_status in ('Finalizada', 'Cancelada') then
    raise exception 'A solicitação % está % — não há material a reservar.', v_codigo, v_status;
  end if;

  -- Trava as linhas do catálogo ANTES de conferir saldo: dois pedidos
  -- simultâneos do mesmo item entram em fila em vez de os dois lerem o
  -- mesmo saldo e os dois passarem. A ordem por id evita travamento
  -- cruzado quando os pedidos têm itens em comum.
  perform 1
     from public.itens i
    where i.id in (select e.item_id
                     from public.solicitacao_equipamentos e
                    where e.solicitacao_id = p_solicitacao
                      and e.item_id is not null)
    order by i.id
      for update;

  -- Sem apelido de tabela: esta função declara `r record` para o laço, e
  -- em PL/pgSQL a variável ganha do apelido — `r.solicitacao_id` seria
  -- lido como campo de um record ainda não atribuído, e o DELETE quebrava
  -- em tempo de execução.
  delete from public.item_reservas
   where solicitacao_id = p_solicitacao
     and situacao = 'Reservado';

  -- Só o que ainda NÃO saiu conta: o que está em campo já foi baixado do
  -- saldo, e contá-lo de novo diria que falta material que está na mão da
  -- própria equipe.
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

  -- Falha tudo ou não falha nada: reservar metade do material de um campo
  -- é pior do que não reservar, porque parece resolvido.
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


-- Solta o que estava reservado e não saiu. Usada no cancelamento e quando
-- um equipamento é retirado do pedido.
create or replace function public.liberar_reservas_solicitacao(p_solicitacao uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if not public.eh_usuario_ativo() then
    raise exception 'Sem permissão.';
  end if;
  -- Sem apelido, pela mesma razão da função acima: apelido de tabela e
  -- nome de variável disputando a mesma letra é bug que só aparece
  -- rodando.
  update public.item_reservas
     set situacao = 'Cancelada'
   where solicitacao_id = p_solicitacao
     and situacao = 'Reservado';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;


-- Auxiliar das duas funções de conferência: escreve na movimentação que
-- o estoque acabou de gerar de qual solicitação ela veio.
--
-- Por que assim, e não passando o texto para o trigger do estoque: lá a
-- observação é fixa ("Ajuste pela edição do cadastro"), e mudar aquele
-- trigger daqui seria um sistema mexendo no schema do outro. A linha que
-- acabou de nascer é sempre a nossa — inserção de outra transação não é
-- visível nesta antes do commit.
create or replace function public.campo_marcar_movimentacao(
  p_item uuid, p_tipo text, p_texto text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  select m.id into v_id
    from public.movimentacoes m
   where m.item_id = p_item and m.tipo = p_tipo
   order by m.data desc, m.id desc
   limit 1;
  if v_id is not null then
    update public.movimentacoes set observacao = p_texto where id = v_id;
  end if;
end;
$$;


-- ── ENTREGA ────────────────────────────────────────────────────────────
-- Registra a conferência de saída e baixa o estoque, numa transação só.
--
-- Antes isto eram N chamadas do navegador: marcar cada item, atualizar o
-- cabeçalho e (na intenção) baixar o estoque. Perder a conexão no meio
-- deixava metade registrado. Aqui é tudo ou nada.
--
-- p_itens: [{"id": "<uuid do equipamento>", "entregue": true, "teste": true}, ...]
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
  if v_status in ('Finalizada', 'Cancelada') then
    raise exception 'A solicitação % está % — não há entrega a registrar.', v_codigo, v_status;
  end if;

  -- `as t(j)` nomeia a coluna explicitamente: `as j` sozinho funciona,
  -- mas deixa `j` valendo como tabela e como coluna ao mesmo tempo, e é
  -- o tipo de ambiguidade que confunde quem lê depois.
  update public.solicitacao_equipamentos e
     set entregue      = coalesce((j->>'entregue')::boolean, e.entregue),
         teste_entrega = coalesce((j->>'teste')::boolean, e.teste_entrega)
    from jsonb_array_elements(p_itens) as t(j)
   where e.id = (j->>'id')::uuid
     and e.solicitacao_id = p_solicitacao;

  -- Trava o catálogo na ordem do id, como na reserva.
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
    -- O saldo é lido DENTRO do laço, e não junto da lista: o mesmo item
    -- pode aparecer em duas linhas do pedido, e a segunda precisa ver o
    -- estoque já descontado pela primeira.
    select i.estoque_atual into v_saldo from public.itens i where i.id = r.item_id;
    if v_saldo < r.quantidade then
      raise exception 'Saldo insuficiente de % (%): % em estoque, % na entrega.',
        r.produto, r.codigo, v_saldo, r.quantidade;
    end if;

    -- É este update que faz o estoque registrar a Saída: lá a
    -- movimentação nasce de trigger, e não de insert nosso.
    update public.itens
       set estoque_atual = estoque_atual - r.quantidade
     where id = r.item_id;

    perform public.campo_marcar_movimentacao(
      r.item_id, 'Saída', format('Saída para a solicitação de campo %s', v_codigo));

    update public.item_reservas
       set situacao = 'Em campo', baixado_em = now()
     where solicitacao_equipamento_id = r.id
       and situacao = 'Reservado';

    -- Equipamento sem reserva é pedido antigo (anterior a esta migração):
    -- a reserva nasce já em campo, para o retorno ter onde se apoiar.
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

  -- Entrega sem nenhum item marcado não é entrega. Deixar passar poria a
  -- solicitação "Em campo" com o material inteiro na prateleira, e a
  -- devolução depois teria de desfazer um estado que nunca existiu.
  if not exists (
    select 1 from public.solicitacao_equipamentos e
     where e.solicitacao_id = p_solicitacao and e.entregue) then
    raise exception 'Marque ao menos um equipamento como entregue.';
  end if;

  -- O trigger do cabeçalho barra 'Em campo' vindo de edição direta; aqui
  -- é a conferência falando, e a chave abaixo é o que diz isso a ele.
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


-- ── DEVOLUÇÃO ──────────────────────────────────────────────────────────
-- Devolve ao estoque, abre a avaria com custo e só finaliza quando tudo
-- voltou. Item que não voltou mantém a solicitação em campo — é este o
-- ponto do checklist: dizer o que está faltando.
--
-- p_itens: [{"id": "<uuid>", "devolvido": true, "teste": true, "avaria": false,
--            "avaria_obs": "", "avaria_custo": 0, "avaria_gravidade": "Leve",
--            "avaria_providencia": "Em análise", "avaria_fornecedor": ""}, ...]
create or replace function public.registrar_devolucao_solicitacao(
  p_solicitacao uuid, p_data date, p_adm text, p_prestador text, p_itens jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_status text; v_codigo text; v_entrega date;
  v_devolvidos integer := 0; v_avarias integer := 0;
  v_pendentes text[] := '{}';
  r record; j jsonb;
begin
  if not public.eh_usuario_ativo() then
    raise exception 'Sem permissão para registrar devolução.';
  end if;
  if p_data is null or length(btrim(coalesce(p_adm, ''))) = 0
     or length(btrim(coalesce(p_prestador, ''))) = 0 then
    raise exception 'Data e as duas assinaturas são obrigatórias na devolução.';
  end if;

  select s.status, s.codigo, s.entrega_data into v_status, v_codigo, v_entrega
    from public.solicitacoes s where s.id = p_solicitacao for update;
  if not found then
    raise exception 'Solicitação não encontrada.';
  end if;
  if v_status = 'Cancelada' then
    raise exception 'A solicitação % está cancelada.', v_codigo;
  end if;
  -- Não se devolve o que não saiu. Sem esta checagem, a restrição de
  -- 01_solicitacoes.sql (devolução exige entrega) barraria com uma
  -- mensagem de banco em vez de uma frase que se entende.
  if v_entrega is null then
    raise exception 'A solicitação % não teve entrega registrada — registre a entrega antes da devolução.', v_codigo;
  end if;

  update public.solicitacao_equipamentos e
     set devolvido       = coalesce((t.j->>'devolvido')::boolean, e.devolvido),
         teste_devolucao = coalesce((t.j->>'teste')::boolean, e.teste_devolucao),
         avaria          = coalesce((t.j->>'avaria')::boolean, e.avaria),
         avaria_obs      = nullif(btrim(coalesce(t.j->>'avaria_obs', '')), '')
    from jsonb_array_elements(p_itens) as t(j)
   where e.id = (t.j->>'id')::uuid
     and e.solicitacao_id = p_solicitacao;

  perform 1 from public.itens i
    where i.id in (select e.item_id from public.solicitacao_equipamentos e
                    where e.solicitacao_id = p_solicitacao and e.item_id is not null)
    order by i.id for update;

  for r in
    select e.id, e.item_id, e.quantidade, e.avaria, e.avaria_obs,
           i.produto, i.codigo, i.categoria
      from public.solicitacao_equipamentos e
      join public.itens i on i.id = e.item_id
     where e.solicitacao_id = p_solicitacao
       and e.item_id is not null
       and e.devolvido
       -- Só volta ao estoque o que está em campo: item já devolvido não
       -- entra duas vezes.
       and exists (select 1 from public.item_reservas x
                    where x.solicitacao_equipamento_id = e.id and x.situacao = 'Em campo')
  loop
    update public.itens
       set estoque_atual = estoque_atual + r.quantidade
     where id = r.item_id;

    perform public.campo_marcar_movimentacao(
      r.item_id, 'Entrada', format('Retorno da solicitação de campo %s', v_codigo));

    update public.item_reservas
       set situacao = 'Devolvido', devolvido_em = now()
     where solicitacao_equipamento_id = r.id
       and situacao = 'Em campo';

    v_devolvidos := v_devolvidos + 1;

    if r.avaria then
      -- O elemento do JSON que fala deste equipamento: é dele que saem o
      -- custo estimado, a gravidade e o fornecedor do reparo.
      select t.j into j
        from jsonb_array_elements(p_itens) as t(j)
       where (t.j->>'id')::uuid = r.id
       limit 1;

      insert into public.solicitacao_avarias (
        solicitacao_id, solicitacao_equipamento_id, item_id, descricao,
        gravidade, providencia, custo_estimado, fornecedor)
      values (
        p_solicitacao, r.id, r.item_id,
        coalesce(nullif(btrim(coalesce(r.avaria_obs, '')), ''), 'AVARIA SEM DESCRIÇÃO'),
        coalesce(nullif(j->>'avaria_gravidade', ''), 'Leve'),
        coalesce(nullif(j->>'avaria_providencia', ''), 'Em análise'),
        coalesce((j->>'avaria_custo')::numeric, 0),
        nullif(btrim(coalesce(j->>'avaria_fornecedor', '')), ''))
      on conflict (solicitacao_equipamento_id) do update
        set descricao      = excluded.descricao,
            gravidade      = excluded.gravidade,
            providencia    = excluded.providencia,
            custo_estimado = excluded.custo_estimado,
            fornecedor     = excluded.fornecedor;

      v_avarias := v_avarias + 1;

      -- Manutenção no Controle de Estoque só é aberta daqui quando o
      -- fornecedor do reparo foi informado: lá em_manutencao exige
      -- fornecedor E justificativa, e inventar um fornecedor para
      -- satisfazer a restrição seria falsear o registro. Sem fornecedor,
      -- o item volta disponível e a avaria fica no relatório aguardando
      -- encaminhamento.
      if r.categoria in ('Equipamentos', 'Eletrônicos')
         and length(btrim(coalesce(j->>'avaria_fornecedor', ''))) > 0 then
        update public.itens
           set em_manutencao            = true,
               manutencao_fornecedor    = upper(btrim(j->>'avaria_fornecedor')),
               manutencao_justificativa = format('AVARIA EM CAMPO · %s · %s',
                 v_codigo, upper(coalesce(r.avaria_obs, 'SEM DESCRIÇÃO')))
         where id = r.item_id
           and not em_manutencao;
      end if;
    end if;
  end loop;

  -- O que não voltou, por nome, para a tela poder dizer.
  select coalesce(array_agg(coalesce(i.produto, e.descricao) order by i.produto), '{}')
    into v_pendentes
    from public.solicitacao_equipamentos e
    left join public.itens i on i.id = e.item_id
   where e.solicitacao_id = p_solicitacao
     and not e.devolvido;

  perform set_config('campo.conferencia', 'on', true);
  update public.solicitacoes
     set devolucao_data      = p_data,
         devolucao_adm       = upper(btrim(p_adm)),
         devolucao_prestador = upper(btrim(p_prestador)),
         status = case when cardinality(v_pendentes) > 0 then 'Em campo' else 'Finalizada' end
   where id = p_solicitacao;

  return jsonb_build_object(
    'codigo', v_codigo, 'devolvidos', v_devolvidos, 'avarias', v_avarias,
    'pendentes', to_jsonb(v_pendentes));
end;
$$;


-- ── ACRÉSCIMO E REMOÇÃO DE EQUIPAMENTO ────────────────────────────────
-- Acrescentar material a um pedido que já existe não é editar uma linha:
-- é pedir material novo, e material novo precisa passar pela disputa de
-- datas como qualquer outro. Por isso o acréscimo é função, e não insert
-- direto — ela reserva na mesma transação e registra no histórico.
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
  if v_status in ('Finalizada', 'Cancelada') then
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


create or replace function public.remover_equipamento_solicitacao(p_equipamento uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare r record; v_nome text;
begin
  if not public.eh_usuario_ativo() then
    raise exception 'Sem permissão.';
  end if;

  select e.id, e.solicitacao_id, e.item_id, e.quantidade, e.entregue, e.devolvido,
         s.codigo, s.status
    into r
    from public.solicitacao_equipamentos e
    join public.solicitacoes s on s.id = e.solicitacao_id
   where e.id = p_equipamento;
  if not found then
    raise exception 'Equipamento não encontrado.';
  end if;

  -- Item que já saiu não sai do pedido: ele está fisicamente com a
  -- equipe, e apagar a linha apagaria a obrigação de devolver.
  if r.entregue and not r.devolvido then
    raise exception 'Este equipamento está em campo — registre a devolução antes de retirá-lo do pedido.';
  end if;

  select i.produto || ' · ' || i.codigo into v_nome from public.itens i where i.id = r.item_id;

  update public.item_reservas
     set situacao = 'Cancelada'
   where solicitacao_equipamento_id = p_equipamento
     and situacao = 'Reservado';

  delete from public.solicitacao_equipamentos where id = p_equipamento;

  insert into public.solicitacao_alteracoes (solicitacao_id, tipo, campo, de, para)
  values (r.solicitacao_id, 'Acréscimo', 'Equipamento retirado',
          format('%s × %s', r.quantidade, coalesce(v_nome, 'item sem catálogo')), null);
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════
--  10. AVARIAS COM CUSTO
--
--  O papel só tinha uma coluna "AVARIA?" e um espaço para observação.
--  Quem paga o conserto precisa de mais: quanto se estima, quanto se
--  gastou de fato, o que foi feito e se ficou resolvido. Uma linha por
--  equipamento avariado, aberta pela devolução e fechada depois.
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.solicitacao_avarias (
  id             uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes(id) on delete cascade,
  -- Único: um equipamento avariado gera uma avaria. Registrar a devolução
  -- de novo atualiza a linha em vez de criar uma segunda.
  solicitacao_equipamento_id uuid unique references public.solicitacao_equipamentos(id) on delete cascade,
  item_id        uuid references public.itens(id) on delete set null,

  descricao   text not null check (length(btrim(descricao)) > 0),
  gravidade   text not null default 'Leve'
              check (gravidade in ('Leve', 'Média', 'Grave', 'Perda total')),
  causa       text,
  responsavel text,

  custo_estimado numeric(14,2) not null default 0 check (custo_estimado >= 0),
  custo_real     numeric(14,2) check (custo_real is null or custo_real >= 0),

  providencia text not null default 'Em análise'
              check (providencia in ('Em análise', 'Manutenção', 'Substituição',
                                     'Descarte', 'Sem reparo', 'Cobrança do prestador')),
  fornecedor  text,
  nota_fiscal text,

  situacao text not null default 'Aberta'
           check (situacao in ('Aberta', 'Em reparo', 'Resolvida', 'Cobrada', 'Baixada')),

  aberto_em  timestamptz not null default now(),
  fechado_em timestamptz,
  usuario_id   uuid references auth.users(id) on delete set null,
  usuario_nome text,

  -- Fechar avaria sem dizer quanto custou esvazia o relatório justamente
  -- na coluna que ele existe para mostrar.
  constraint solicitacao_avarias_custo_check check (
    situacao not in ('Resolvida', 'Cobrada') or custo_real is not null
  )
);
create index if not exists solicitacao_avarias_sol_idx  on public.solicitacao_avarias (solicitacao_id);
create index if not exists solicitacao_avarias_item_idx on public.solicitacao_avarias (item_id);
create index if not exists solicitacao_avarias_sit_idx  on public.solicitacao_avarias (situacao, aberto_em desc);

comment on table public.solicitacao_avarias is
  'Avaria de equipamento de campo com custo estimado e custo real. Aberta pela devolução; o custo real é preenchido quando o conserto acontece.';


-- ═══════════════════════════════════════════════════════════════════════
--  11. ASSINATURA DIGITAL DO CHECKLIST
--
--  As quatro assinaturas do papel (administrativo e prestador, na
--  retirada e na devolução) deixam de ser um nome digitado e passam a ser
--  o traço desenhado na tela — no celular, com o dedo, na hora da
--  conferência. A imagem é um PNG em data URL, guardada junto do pedido.
--
--  Uma linha por momento × papel, garantido por unicidade: assinatura não
--  se acumula, se substitui até a conferência ser registrada.
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.solicitacao_assinaturas (
  id             uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes(id) on delete cascade,
  momento text not null check (momento in ('Retirada', 'Devolução')),
  papel   text not null check (papel in ('Administrativo', 'Prestador')),

  nome      text not null check (length(btrim(nome)) > 0),
  documento text,

  -- PNG em data URL. O limite superior existe para uma assinatura não
  -- virar upload de foto: 400 KB de base64 é muito mais do que um traço
  -- de 600×200 precisa.
  imagem text not null check (
    imagem like 'data:image/png;base64,%' and length(imagem) between 200 and 400000
  ),

  assinado_em  timestamptz not null default now(),
  usuario_id   uuid references auth.users(id) on delete set null,
  usuario_nome text,

  constraint solicitacao_assinaturas_unica unique (solicitacao_id, momento, papel)
);
create index if not exists solicitacao_assinaturas_idx on public.solicitacao_assinaturas (solicitacao_id);

comment on table public.solicitacao_assinaturas is
  'Assinatura desenhada na tela, uma por momento (Retirada/Devolução) e papel (Administrativo/Prestador). Sai impressa no checklist.';


-- ═══════════════════════════════════════════════════════════════════════
--  12. HISTÓRICO — edição e acréscimo
--
--  O pedido de campo muda depois de aberto: a data anda, o hotel troca,
--  entra mais um equipamento. Sem registro, ninguém sabe se o que está na
--  tela é o que foi combinado. Mesma ideia do historico_alteracoes do
--  estoque: quem escreve é trigger, não o aplicativo.
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.solicitacao_alteracoes (
  id             uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes(id) on delete cascade,
  data  timestamptz not null default now(),
  tipo  text not null default 'Edição'
        check (tipo in ('Edição', 'Acréscimo', 'Status', 'Custo')),
  campo text not null,
  de    text,
  para  text,
  usuario_id   uuid references auth.users(id) on delete set null,
  usuario_nome text
);
create index if not exists solicitacao_alteracoes_idx on public.solicitacao_alteracoes (solicitacao_id, data desc);

comment on table public.solicitacao_alteracoes is
  'O que mudou em cada solicitação, quando e por quem. Escrito por trigger — não depende de o navegador se comportar.';


-- ═══════════════════════════════════════════════════════════════════════
--  13. LIMPEZA — o que a aprovação deixou para trás
--
--  Os três campos abaixo só existiam para o despacho. O motivo já foi
--  copiado para motivo_cancelamento na seção 1, então nada se perde;
--  deixá-los ali convidaria alguém a gravar neles um dia.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.solicitacoes drop column if exists aprovado_por;
alter table public.solicitacoes drop column if exists aprovado_em;
alter table public.solicitacoes drop column if exists motivo_recusa;


-- ═══════════════════════════════════════════════════════════════════════
--  14. TRIGGERS — autoria, datas e tudo que é calculado
-- ═══════════════════════════════════════════════════════════════════════

-- Autoria das tabelas-filhas de campo (mesma função do estoque, com nome
-- próprio para os dois sistemas não dependerem um do outro).
create or replace function public.campo_autoria()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.usuario_id   := (select auth.uid());
  new.usuario_nome := public.nome_atual();
  return new;
end;
$$;

drop trigger if exists item_reservas_autoria on public.item_reservas;
create trigger item_reservas_autoria before insert on public.item_reservas
  for each row execute function public.campo_autoria();

drop trigger if exists solicitacao_avarias_autoria on public.solicitacao_avarias;
create trigger solicitacao_avarias_autoria before insert on public.solicitacao_avarias
  for each row execute function public.campo_autoria();

drop trigger if exists solicitacao_assinaturas_autoria on public.solicitacao_assinaturas;
create trigger solicitacao_assinaturas_autoria before insert on public.solicitacao_assinaturas
  for each row execute function public.campo_autoria();

drop trigger if exists solicitacao_alteracoes_autoria on public.solicitacao_alteracoes;
create trigger solicitacao_alteracoes_autoria before insert on public.solicitacao_alteracoes
  for each row execute function public.campo_autoria();


-- Carimbo dos cadastros (projetos e hotéis).
create or replace function public.campo_cadastro_carimbo()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.criado_em  := now();
    new.criado_por := (select auth.uid());
  else
    new.criado_em  := old.criado_em;
    new.criado_por := old.criado_por;
  end if;
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists projetos_carimbo on public.projetos;
create trigger projetos_carimbo before insert or update on public.projetos
  for each row execute function public.campo_cadastro_carimbo();

drop trigger if exists hoteis_carimbo on public.hoteis;
create trigger hoteis_carimbo before insert or update on public.hoteis
  for each row execute function public.campo_cadastro_carimbo();


-- ── O trigger do cabeçalho, refeito ──────────────────────────────────
--
-- Muda em três pontos em relação ao de 01_solicitacoes.sql:
--
--  1. Sai a checagem de aprovação — não existe mais aprovação.
--  2. Entram os totais, o desvio e o STATUS DE CURSO, calculados aqui e
--     nunca digitados (mesma escolha do Status e do Valor Total no
--     estoque). A faixa de tolerância é de 5%: gasto entre 95% e 105% do
--     previsto é "Dentro do previsto". Sem faixa, um combustível de dez
--     reais jogaria todo campo para "acima" ou "abaixo" e o indicador
--     não diria mais nada.
--  3. Entra a identificação de SST, pela mesma razão.
--
-- 'Em campo' e 'Finalizada' passam a ser recusados quando vêm de edição
-- direta: esses dois estados são consequência da conferência, e a
-- conferência é quem mexe no saldo do estoque. Deixar um update qualquer
-- declarar "em campo" faria o estoque e a solicitação contarem histórias
-- diferentes. As funções de entrega e devolução avisam que são elas
-- falando pela chave `campo.conferencia`.
create or replace function public.solicitacoes_antes_de_gravar()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_prev numeric(14,2); v_real numeric(14,2);
begin
  if tg_op = 'INSERT' then
    new.solicitante_id   := (select auth.uid());
    new.solicitante_nome := coalesce(public.nome_atual(), new.solicitante_nome);
    new.status           := 'Solicitada';
  else
    new.codigo           := old.codigo;
    new.criado_em         := old.criado_em;
    new.solicitante_id    := old.solicitante_id;
    new.solicitante_nome  := old.solicitante_nome;

    if new.status is distinct from old.status then
      if new.status in ('Em campo', 'Finalizada')
         and coalesce(current_setting('campo.conferencia', true), '') <> 'on' then
        raise exception 'Em campo e Finalizada saem da conferência de equipamentos, não de edição direta.';
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

  -- Previsto × real: totais, desvio e status de curso.
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

  -- SST: a identificação é a conferência inteira fechada, ou não é nada.
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


-- Histórico do cabeçalho: uma linha por campo que mudou. A lista é
-- explícita de propósito — comparar coluna por coluna com um loop sobre o
-- catálogo do sistema registraria também as calculadas, e o histórico
-- viraria ruído.
create or replace function public.solicitacoes_depois_de_atualizar()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.solicitacao_alteracoes (solicitacao_id, tipo, campo, de, para)
  select new.id,
         case when c.campo = 'Status' then 'Status'
              when c.campo like 'Previsto%' or c.campo like 'Real%' then 'Custo'
              else 'Edição' end,
         c.campo, c.de, c.para
    from (values
      ('Status',                old.status,                      new.status),
      ('Setor',                 old.setor,                       new.setor),
      ('Cliente | Projeto',     old.cliente_projeto,             new.cliente_projeto),
      ('Código Clockify',       old.codigo_clockify,             new.codigo_clockify),
      ('Destino',               old.destino,                     new.destino),
      ('Período — início',      old.periodo_inicio::text,        new.periodo_inicio::text),
      ('Período — fim',         old.periodo_fim::text,           new.periodo_fim::text),
      ('Data do recurso',       old.data_recurso::text,          new.data_recurso::text),
      ('Observação',            old.observacao,                  new.observacao),
      ('Condutor',              old.veiculo_condutor,            new.veiculo_condutor),
      ('Veículo',               old.veiculo_descricao,           new.veiculo_descricao),
      ('Locadora',              old.transporte_locadora,         new.transporte_locadora),
      ('Contrato do transporte', old.transporte_contrato,        new.transporte_contrato),
      ('Previsto · veículo',    old.previsto_veiculo::text,      new.previsto_veiculo::text),
      ('Previsto · hospedagem', old.previsto_hospedagem::text,   new.previsto_hospedagem::text),
      ('Previsto · alimentação', old.previsto_alimentacao::text, new.previsto_alimentacao::text),
      ('Previsto · outros',     old.previsto_outros::text,       new.previsto_outros::text),
      ('Real · veículo',        old.real_veiculo::text,          new.real_veiculo::text),
      ('Real · hospedagem',     old.real_hospedagem::text,       new.real_hospedagem::text),
      ('Real · alimentação',    old.real_alimentacao::text,      new.real_alimentacao::text),
      ('Real · outros',         old.real_outros::text,           new.real_outros::text),
      ('Motivo do cancelamento', old.motivo_cancelamento,        new.motivo_cancelamento),
      ('SST',                   old.sst_identificacao,           new.sst_identificacao)
    ) as c(campo, de, para)
   where c.de is distinct from c.para;

  return null;
end;
$$;

drop trigger if exists solicitacoes_depois_de_atualizar on public.solicitacoes;
create trigger solicitacoes_depois_de_atualizar
  after update on public.solicitacoes
  for each row execute function public.solicitacoes_depois_de_atualizar();


-- Avaria fechada carimba a data de fechamento sozinha.
create or replace function public.avarias_antes_de_gravar()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.situacao in ('Resolvida', 'Cobrada', 'Baixada') then
    new.fechado_em := coalesce(new.fechado_em, now());
  else
    new.fechado_em := null;
  end if;
  return new;
end;
$$;

drop trigger if exists avarias_antes_de_gravar on public.solicitacao_avarias;
create trigger avarias_antes_de_gravar
  before insert or update on public.solicitacao_avarias
  for each row execute function public.avarias_antes_de_gravar();


-- ═══════════════════════════════════════════════════════════════════════
--  15. PERMISSÕES E RLS
--
--  Mesmo desenho do estoque: revoga tudo, concede o necessário, RLS em
--  todas as tabelas e `anon` sem acesso a nada.
--
--  Duas tabelas são SÓ LEITURA para o aplicativo — `item_reservas` e
--  `solicitacao_alteracoes`. Quem escreve nelas são as funções desta
--  migração, que rodam como dono e conferem saldo e datas antes. Deixar o
--  navegador inserir reserva à mão desfaria toda a garantia de que dois
--  pedidos simultâneos não furam o estoque.
-- ═══════════════════════════════════════════════════════════════════════
revoke all on public.projetos                from anon, authenticated;
revoke all on public.hoteis                  from anon, authenticated;
revoke all on public.diaria_valores          from anon, authenticated;
revoke all on public.solicitacao_equipe      from anon, authenticated;
revoke all on public.solicitacao_sst_epis    from anon, authenticated;
revoke all on public.item_reservas           from anon, authenticated;
revoke all on public.solicitacao_avarias     from anon, authenticated;
revoke all on public.solicitacao_assinaturas from anon, authenticated;
revoke all on public.solicitacao_alteracoes  from anon, authenticated;

grant select, insert, update, delete on public.projetos               to authenticated;
grant select, insert, update, delete on public.hoteis                 to authenticated;
grant select, update                 on public.diaria_valores         to authenticated;
grant select, insert, update, delete on public.solicitacao_equipe     to authenticated;
grant select, insert, update, delete on public.solicitacao_sst_epis   to authenticated;
grant select                         on public.item_reservas          to authenticated;
grant select, insert, update, delete on public.solicitacao_avarias    to authenticated;
grant select, insert                 on public.solicitacao_assinaturas to authenticated;
grant select                         on public.solicitacao_alteracoes to authenticated;

alter table public.projetos                enable row level security;
alter table public.hoteis                  enable row level security;
alter table public.diaria_valores          enable row level security;
alter table public.solicitacao_equipe      enable row level security;
alter table public.solicitacao_sst_epis    enable row level security;
alter table public.item_reservas           enable row level security;
alter table public.solicitacao_avarias     enable row level security;
alter table public.solicitacao_assinaturas enable row level security;
alter table public.solicitacao_alteracoes  enable row level security;

-- ── Cadastros: todo usuário ativo consulta e mantém; só a Gestão exclui.
--    Excluir hotel ou projeto derruba o vínculo de solicitações antigas,
--    e por isso é decisão de quem responde pelo cadastro.
do $$
declare t text;
begin
  foreach t in array array['projetos', 'hoteis'] loop
    execute format('drop policy if exists "%s: usuário ativo consulta" on public.%I', t, t);
    execute format('create policy "%s: usuário ativo consulta" on public.%I
                      for select to authenticated using (public.eh_usuario_ativo())', t, t);
    execute format('drop policy if exists "%s: usuário ativo cadastra" on public.%I', t, t);
    execute format('create policy "%s: usuário ativo cadastra" on public.%I
                      for insert to authenticated with check (public.eh_usuario_ativo())', t, t);
    execute format('drop policy if exists "%s: usuário ativo edita" on public.%I', t, t);
    execute format('create policy "%s: usuário ativo edita" on public.%I
                      for update to authenticated
                      using (public.eh_usuario_ativo()) with check (public.eh_usuario_ativo())', t, t);
    execute format('drop policy if exists "%s: só Gestão exclui" on public.%I', t, t);
    execute format('create policy "%s: só Gestão exclui" on public.%I
                      for delete to authenticated using (public.eh_gestor())', t, t);
  end loop;
end $$;

-- ── Valor da diária: todo mundo lê, só a Gestão muda. É parâmetro de
--    pagamento, não preferência de tela.
drop policy if exists "diárias: usuário ativo consulta" on public.diaria_valores;
create policy "diárias: usuário ativo consulta" on public.diaria_valores
  for select to authenticated using (public.eh_usuario_ativo());

drop policy if exists "diárias: só Gestão ajusta" on public.diaria_valores;
create policy "diárias: só Gestão ajusta" on public.diaria_valores
  for update to authenticated using (public.eh_gestor()) with check (public.eh_gestor());

-- ── Linhas-filhas da solicitação: mesma regra das outras (equipe, EPIs).
do $$
declare t text;
begin
  foreach t in array array['solicitacao_equipe', 'solicitacao_sst_epis'] loop
    execute format('drop policy if exists "%s: usuário ativo consulta" on public.%I', t, t);
    execute format('create policy "%s: usuário ativo consulta" on public.%I
                      for select to authenticated using (public.eh_usuario_ativo())', t, t);
    execute format('drop policy if exists "%s: usuário ativo grava" on public.%I', t, t);
    execute format('create policy "%s: usuário ativo grava" on public.%I
                      for all to authenticated
                      using (public.eh_usuario_ativo()) with check (public.eh_usuario_ativo())', t, t);
  end loop;
end $$;

-- ── Reservas e histórico: leitura para quem usa o sistema, escrita só
--    pelas funções desta migração (que rodam como dono e não passam por
--    política).
drop policy if exists "reservas: usuário ativo consulta" on public.item_reservas;
create policy "reservas: usuário ativo consulta" on public.item_reservas
  for select to authenticated using (public.eh_usuario_ativo());

drop policy if exists "alterações: usuário ativo consulta" on public.solicitacao_alteracoes;
create policy "alterações: usuário ativo consulta" on public.solicitacao_alteracoes
  for select to authenticated using (public.eh_usuario_ativo());

-- ── Avarias: quem usa consulta e completa o custo; só a Gestão apaga.
drop policy if exists "avarias: usuário ativo consulta" on public.solicitacao_avarias;
create policy "avarias: usuário ativo consulta" on public.solicitacao_avarias
  for select to authenticated using (public.eh_usuario_ativo());

drop policy if exists "avarias: usuário ativo registra" on public.solicitacao_avarias;
create policy "avarias: usuário ativo registra" on public.solicitacao_avarias
  for insert to authenticated with check (public.eh_usuario_ativo());

drop policy if exists "avarias: usuário ativo atualiza" on public.solicitacao_avarias;
create policy "avarias: usuário ativo atualiza" on public.solicitacao_avarias
  for update to authenticated
  using (public.eh_usuario_ativo()) with check (public.eh_usuario_ativo());

drop policy if exists "avarias: só Gestão exclui" on public.solicitacao_avarias;
create policy "avarias: só Gestão exclui" on public.solicitacao_avarias
  for delete to authenticated using (public.eh_gestor());

-- ── Assinaturas: entram e não saem. Sem update e sem delete para o
--    aplicativo — assinatura que se reescreve não prova nada. Corrigir
--    uma assinatura errada é assunto da Gestão, direto no banco.
drop policy if exists "assinaturas: usuário ativo consulta" on public.solicitacao_assinaturas;
create policy "assinaturas: usuário ativo consulta" on public.solicitacao_assinaturas
  for select to authenticated using (public.eh_usuario_ativo());

drop policy if exists "assinaturas: usuário ativo assina" on public.solicitacao_assinaturas;
create policy "assinaturas: usuário ativo assina" on public.solicitacao_assinaturas
  for insert to authenticated with check (public.eh_usuario_ativo());


-- ── Funções: as que o aplicativo chama, e as que são só de apoio ──────
revoke execute on function public.campo_autoria()                     from public, anon, authenticated;
revoke execute on function public.campo_cadastro_carimbo()            from public, anon, authenticated;
revoke execute on function public.campo_marcar_movimentacao(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.solicitacoes_antes_de_gravar()      from public, anon, authenticated;
revoke execute on function public.solicitacoes_depois_de_atualizar()  from public, anon, authenticated;
revoke execute on function public.avarias_antes_de_gravar()           from public, anon, authenticated;

revoke execute on function public.item_comprometido(uuid, date, date, uuid) from public, anon;
revoke execute on function public.itens_disponiveis_no_periodo(date, date, uuid) from public, anon;
revoke execute on function public.reservar_equipamentos_solicitacao(uuid) from public, anon;
revoke execute on function public.liberar_reservas_solicitacao(uuid)      from public, anon;
revoke execute on function public.registrar_entrega_solicitacao(uuid, date, text, text, jsonb) from public, anon;
revoke execute on function public.registrar_devolucao_solicitacao(uuid, date, text, text, jsonb) from public, anon;
revoke execute on function public.acrescentar_equipamento_solicitacao(uuid, uuid, integer, text) from public, anon;
revoke execute on function public.remover_equipamento_solicitacao(uuid) from public, anon;

grant execute on function public.item_comprometido(uuid, date, date, uuid) to authenticated;
grant execute on function public.itens_disponiveis_no_periodo(date, date, uuid) to authenticated;
grant execute on function public.reservar_equipamentos_solicitacao(uuid) to authenticated;
grant execute on function public.liberar_reservas_solicitacao(uuid)      to authenticated;
grant execute on function public.registrar_entrega_solicitacao(uuid, date, text, text, jsonb) to authenticated;
grant execute on function public.registrar_devolucao_solicitacao(uuid, date, text, text, jsonb) to authenticated;
grant execute on function public.acrescentar_equipamento_solicitacao(uuid, uuid, integer, text) to authenticated;
grant execute on function public.remover_equipamento_solicitacao(uuid) to authenticated;

commit;


-- ═══════════════════════════════════════════════════════════════════════
--  CONFERÊNCIA — rode depois do commit para ver se ficou tudo de pé
-- ═══════════════════════════════════════════════════════════════════════
select
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name in ('projetos', 'hoteis', 'diaria_valores', 'solicitacao_equipe',
                         'solicitacao_sst_epis', 'item_reservas', 'solicitacao_avarias',
                         'solicitacao_assinaturas', 'solicitacao_alteracoes'))  as tabelas_de_9,
  (select count(*) from public.diaria_valores)                                  as diarias_de_5,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('item_comprometido', 'itens_disponiveis_no_periodo',
                        'reservar_equipamentos_solicitacao', 'liberar_reservas_solicitacao',
                        'registrar_entrega_solicitacao', 'registrar_devolucao_solicitacao',
                        'acrescentar_equipamento_solicitacao',
                        'remover_equipamento_solicitacao'))                     as funcoes_de_8,
  (select count(*) from public.solicitacoes where status not in
    ('Solicitada', 'Logística confirmada', 'Em campo', 'Finalizada', 'Cancelada')) as status_invalidos_zero;
