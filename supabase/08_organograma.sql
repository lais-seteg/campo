-- ═══════════════════════════════════════════════════════════════════════
--  08 · ORGANOGRAMA — O CADASTRO DE COLABORADORES
--
--  Rode DEPOIS de 07_quem_ve_dinheiro.sql. É idempotente: pode rodar de
--  novo sem estragar nada.
--
--  ── O PROBLEMA QUE ELE RESOLVE ──
--
--  Não existia cadastro de gente neste sistema. Havia duas listas, e
--  nenhuma das duas era um cadastro:
--
--   1. `perfis` — tabela do Controle de Estoque, compartilhada. Ela é a
--      lista de QUEM ENTRA no sistema, não de quem trabalha na empresa: a
--      chave primária tem FK para `auth.users`, então cadastrar alguém lá
--      significa criar um login. Colaborador que não usa o sistema não
--      cabe nela.
--   2. `TECNICOS`, em lib/listas.ts — dez nomes com código de registro,
--      copiados na mão da planilha e chumbados no código. Mudar a equipe
--      exigia deploy.
--
--  E o seletor de líder do projeto oferecia `perfis` INTEIRA, sem filtro:
--  os 33 acessos, técnico por técnico, como candidatos a aprovar campo.
--
--  `colaboradores` é o cadastro que faltava. Pessoa entra aqui com ou sem
--  login; quem também acessa o sistema fica LIGADA ao `perfis` por
--  `perfil_id`.
--
--  ── POR QUE NÃO ESTENDER O `perfis` ──
--
--  Porque `perfis.id` referencia `auth.users(id)`. Cadastrar colaborador
--  em `perfis` seria criar usuário de autenticação para quem não vai
--  entrar no sistema — e a aplicação nem poderia fazê-lo: ela usa a chave
--  anônima, que não cria usuário. `perfis` também é do Controle de
--  Estoque, e alargar o significado dela mudaria o outro sistema junto.
--
--  ── QUEM PODE SER LÍDER ──
--
--  ESTAR NO ORGANOGRAMA BASTA. Não existe marca de autorização por pessoa:
--  colaborador cadastrado e ativo é candidato a líder no cadastro de
--  projetos. (Houve uma coluna `pode_liderar` para isso; ela foi removida
--  na migração `organograma_todos_aptos_a_liderar` — a decisão passou a ser
--  "quem está cadastrado".)
--
--  Sobra UMA condição, e ela não é preferência de produto: a pessoa precisa
--  de ACESSO AO SISTEMA (`perfil_id`). Liderar projeto é APROVAR campo, e a
--  aprovação passa pela RLS e por `aprovar_solicitacao_lider()`, que
--  comparam `auth.uid()` com `projetos.lider_id`. Quem não entra no sistema
--  não tem como aprovar — o campo nasceria esperando decisão de quem não
--  pode decidir. Quem filtra isso é `lideresDisponiveis()`
--  (lib/consultas.ts), pelo `perfil_id`.
--
--  `projetos.lider_id` continua apontando para `perfis`, e é de propósito:
--  é o id que a RLS confere. O organograma decide QUEM ENTRA na lista; o
--  vínculo que dá poder de aprovar continua sendo o mesmo de antes.
--
--  ── SÓ A DIREÇÃO VÊ ──
--
--  Leitura e escrita são de `eh_direcao()`. Diferente de `hoteis` (que
--  todo mundo lê porque a logística escolhe da lista), o organograma é
--  cadastro de pessoal: cargo, setor, contato e vínculo da empresa
--  inteira. Não é dado de navegação, e a tela onde ele é usado — o
--  cadastro de projetos — já é exclusiva da Direção.
--
--  CONSEQUÊNCIA: a Gestão NÃO lê esta tabela, ao contrário do que
--  `eh_gestor()` faz em quase todo o resto. Foi decisão explícita.
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
--  1. A TABELA
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.colaboradores (
  id   uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) > 0),

  -- Matrícula, CREA, CPF do temporário: o número por onde o RH e o
  -- cliente identificam a pessoa. É o que desempata homônimo — ver o
  -- índice único mais abaixo.
  codigo   text,
  cargo    text,
  setor    text,
  telefone text,
  email    text,

  -- O MESMO vínculo de `diaria_valores`: é ele que decide qual diária a
  -- pessoa recebe. Lista fechada porque "Temporario" e "temporário" em
  -- texto livre fariam a diária sair de dois cadastros diferentes.
  vinculo text not null default 'Seteg'
    check (vinculo in ('Seteg', 'Temporário')),

  -- O acesso desta pessoa ao sistema, quando ela tem um. NULO é o caso
  -- comum: colaborador de campo não precisa de login.
  --
  -- `on delete set null` e não `cascade`: se o acesso for removido, a
  -- pessoa continua no organograma — ela não deixou de existir, só perdeu
  -- o login. `unique` porque um acesso é de uma pessoa só.
  perfil_id uuid unique references public.perfis(id) on delete set null,

  ativo      boolean not null default true,
  observacao text,

  criado_em     timestamptz not null default now(),
  criado_por    uuid references auth.users(id) on delete set null,
  atualizado_em timestamptz not null default now()

  -- NÃO há coluna de "autorizado a liderar". Estar cadastrado e ativo basta
  -- para ser candidato a líder; o que decide se a pessoa aparece no seletor
  -- é ter `perfil_id`, e isso se resolve na consulta, não numa trava — ver
  -- o cabeçalho deste arquivo.
);

-- Matrícula não repete. Parcial porque a maioria dos cadastros começa sem
-- código, e `unique` cru barraria o segundo nulo em alguns bancos.
create unique index if not exists colaboradores_codigo_unico
  on public.colaboradores (codigo)
  where codigo is not null;

-- ── HOMÔNIMO É PERMITIDO; CADASTRO EM DOBRO, NÃO ──
--
-- Duas pessoas com o mesmo nome existem de verdade (`perfis` já tem duas
-- "Juliana Vicente"), então travar por nome seria travar a realidade. O
-- que esta chave barra é a MESMA pessoa cadastrada duas vezes: para
-- coexistirem, os homônimos precisam de código diferente — e aí não são
-- mais um erro de digitação, são duas pessoas identificadas.
create unique index if not exists colaboradores_nome_unico
  on public.colaboradores (upper(btrim(nome)), coalesce(codigo, ''));

-- O seletor de líder do projeto lê exatamente por aqui: colaborador ativo
-- COM acesso ao sistema.
create index if not exists colaboradores_perfil_idx
  on public.colaboradores (perfil_id)
  where perfil_id is not null;

comment on table public.colaboradores is
  'Organograma: quem trabalha na empresa, com ou sem acesso ao sistema. Leitura e escrita só da Direção. Quem tem login fica ligado a perfis por perfil_id — e quem tem perfil_id e está ativo é candidato a líder de projeto, porque liderar é aprovar campo e a aprovação confere quem esta logado.';

comment on column public.colaboradores.perfil_id is
  'O acesso desta pessoa ao sistema, quando existe. Nulo é o caso comum: colaborador de campo não precisa de login. É este id que vai para projetos.lider_id — e é ele que faz a pessoa aparecer no seletor de líder.';

comment on column public.colaboradores.codigo is
  'Matrícula, CREA ou documento pelo qual o RH e o cliente identificam a pessoa. É o que desempata homônimo.';


-- ═══════════════════════════════════════════════════════════════════════
--  2. CRIADO_POR E ATUALIZADO_EM SÃO DO BANCO
--
--  Mesmo desenho de `projeto_gastos_antes_de_gravar`: quem gravou e
--  quando não podem depender de o cliente mandar o campo certo. E no
--  UPDATE o `criado_em`/`criado_por` originais são restaurados — editar um
--  cadastro não reescreve quem o criou.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.colaboradores_antes_de_gravar()
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

drop trigger if exists colaboradores_antes_de_gravar on public.colaboradores;
create trigger colaboradores_antes_de_gravar
  before insert or update on public.colaboradores
  for each row execute function public.colaboradores_antes_de_gravar();

revoke execute on function public.colaboradores_antes_de_gravar() from public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════
--  3. AS POLÍTICAS — LEITURA INCLUSA, SÓ DA DIREÇÃO
-- ═══════════════════════════════════════════════════════════════════════
alter table public.colaboradores enable row level security;

drop policy if exists "colaboradores: só a Direção consulta" on public.colaboradores;
drop policy if exists "colaboradores: só a Direção cadastra" on public.colaboradores;
drop policy if exists "colaboradores: só a Direção edita"    on public.colaboradores;
drop policy if exists "colaboradores: só a Direção exclui"   on public.colaboradores;

create policy "colaboradores: só a Direção consulta" on public.colaboradores
  for select to authenticated using (public.eh_direcao());

create policy "colaboradores: só a Direção cadastra" on public.colaboradores
  for insert to authenticated with check (public.eh_direcao());

create policy "colaboradores: só a Direção edita" on public.colaboradores
  for update to authenticated using (public.eh_direcao()) with check (public.eh_direcao());

create policy "colaboradores: só a Direção exclui" on public.colaboradores
  for delete to authenticated using (public.eh_direcao());


-- ═══════════════════════════════════════════════════════════════════════
--  4. O ORGANOGRAMA COMEÇA COM QUEM JÁ EXISTE
--
--  Tabela vazia significaria nenhum líder no seletor e nenhum projeto novo
--  cadastrável até alguém digitar 33 nomes. Então o organograma nasce
--  populado a partir dos acessos ATIVOS de `perfis`, cada um ligado ao seu
--  `perfil_id`.
--
--  Como não há mais marca de autorização, TODO MUNDO que entra aqui já
--  nasce candidato a líder — todos vêm de `perfis`, então todos têm
--  `perfil_id`. É o que a Direção pediu: quem está no organograma está apto
--  a liderar quando um projeto novo for cadastrado.
--
--  `on conflict do nothing` faz este bloco ser seguro de rodar de novo: se
--  a pessoa já está no organograma, a rodada seguinte não a duplica nem
--  reverte o que a Direção ajustou na tela depois.
-- ═══════════════════════════════════════════════════════════════════════
--  ── O CARGO NASCE VAZIO, DE PROPÓSITO ──
--
--  A primeira versão deste bloco copiava `perfis.cargo`. Parou de copiar
--  quando o cargo virou LISTA FECHADA na tela (`CARGOS` em lib/tipos.ts:
--  Analista Ambiental I, II, III e Gestão). Os cargos do `perfis` são
--  outros — "Colaborador", "Assistente de Compras", "Financeiro" —, e
--  trazê-los encheria o organograma de valores que o seletor não oferece:
--  trinta linhas que a Direção teria de corrigir uma por uma sem que
--  nenhuma delas estivesse certa para começo de conversa.
--
--  Vazio é honesto: o cargo é informação de RH que este sistema passou a
--  ter opinião sobre, e quem preenche é quem sabe.
insert into public.colaboradores (nome, vinculo, perfil_id, ativo)
select
  upper(btrim(p.nome)),
  'Seteg',
  p.id,
  true
from public.perfis p
where p.ativo
  and not exists (select 1 from public.colaboradores c where c.perfil_id = p.id)
on conflict do nothing;


-- ═══════════════════════════════════════════════════════════════════════
--  5. CONFERÊNCIA
--
--  `projetos_com_lider_fora_do_organograma` tem de vir ZERO. Projeto cujo
--  líder não está no organograma continua funcionando (a RLS não mudou),
--  mas a Direção não conseguiria escolhê-lo de novo ao editar o projeto —
--  ele só apareceria marcado como "fora do organograma".
--
--  `candidatos_a_lider` é a conta que o cadastro de projetos vai oferecer.
--  Zero significa nenhum projeto novo cadastrável.
-- ═══════════════════════════════════════════════════════════════════════
select
  (select count(*) from public.colaboradores)                      as colaboradores,
  (select count(*) from public.colaboradores
    where ativo and perfil_id is not null)                         as candidatos_a_lider,
  (select count(*) from public.colaboradores where perfil_id is null)
                                                                   as sem_acesso_ao_sistema,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'colaboradores')    as politicas,
  (select count(*) from public.projetos pr
    where pr.lider_id is not null
      and not exists (select 1 from public.colaboradores c
                       where c.perfil_id = pr.lider_id and c.ativo))
                                                     as projetos_com_lider_fora_do_organograma;
