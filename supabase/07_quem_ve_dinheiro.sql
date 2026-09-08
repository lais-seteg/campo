-- ═══════════════════════════════════════════════════════════════════════
--  07 · CORRIGE QUEM VÊ DINHEIRO
--
--  Rode DEPOIS de 06_cadastros_do_administrativo.sql.
--
--  ── O QUE A v3 ERROU ──
--
--  A v3 (05) colocou `administrativo` entre quem vê valor consolidado, e a
--  06 deu a ele os cadastros. A primeira parte estava errada para esta
--  operação:
--
--    · o `administrativo` é quem FAZ — cadastra hotel, providencia veículo,
--      material e hospedagem, abre e acompanha pedido. Operar não exige o
--      previsto × real da empresa, e dar dado sensível a quem não precisa é
--      espalhar risco sem ganhar nada;
--    · quem RESPONDE pelo dinheiro dessa operação é a GESTÃO — e ela estava
--      fora da lista.
--
--  Então as duas trocam de lado. É a única assimetria entre `gestor` e
--  `administrativo`, e é deliberada.
--
--  ── QUEM FICA COM O QUÊ, DEPOIS DESTE ARQUIVO ──
--
--    ver valor consolidado → direcao, gestor, financeiro, e o LÍDER nos
--                            projetos que ele lidera
--    cadastros (hotel,     → administrativo (opera) + gestor/direcao
--    valor da diária)        (supervisionam)
--    administrativo        → opera tudo, NÃO vê valor consolidado
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.pode_ver_valores()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(
    public.papel_atual() in ('direcao', 'gestor', 'financeiro')
    or exists (
      select 1 from public.projetos p
       where p.lider_id = (select auth.uid())
    ),
    false)
$$;

comment on function public.pode_ver_valores() is
  'Direção, gestor, financeiro — ou quem lidera algum projeto. Libera valor consolidado (previsto x real, gasto previsto, custo de avaria). NÃO inclui administrativo: ele opera o cadastro e a logística, e não vê dado sensível.';

revoke all    on function public.pode_ver_valores() from public, anon;
grant  execute on function public.pode_ver_valores() to authenticated;


-- ── CADASTROS: quem OPERA e quem SUPERVISIONA ──
--
-- A 06 deixou a escrita só com o administrativo. A Gestão entra junto: "o
-- gestor vê tudo", e quem supervisiona precisa poder corrigir o que o
-- operador cadastrou. `eh_gestor()` já inclui a Direção.
drop policy if exists "hoteis: administrativo cadastra"            on public.hoteis;
drop policy if exists "hoteis: administrativo edita"               on public.hoteis;
drop policy if exists "hoteis: administrativo exclui"              on public.hoteis;
drop policy if exists "hoteis: administrativo e Gestão cadastram"  on public.hoteis;
drop policy if exists "hoteis: administrativo e Gestão editam"     on public.hoteis;
drop policy if exists "hoteis: administrativo e Gestão excluem"    on public.hoteis;

create policy "hoteis: administrativo e Gestão cadastram" on public.hoteis
  for insert to authenticated
  with check (public.eh_administrativo() or public.eh_gestor());

create policy "hoteis: administrativo e Gestão editam" on public.hoteis
  for update to authenticated
  using (public.eh_administrativo() or public.eh_gestor())
  with check (public.eh_administrativo() or public.eh_gestor());

create policy "hoteis: administrativo e Gestão excluem" on public.hoteis
  for delete to authenticated
  using (public.eh_administrativo() or public.eh_gestor());

drop policy if exists "diárias: administrativo ajusta"            on public.diaria_valores;
drop policy if exists "diárias: administrativo e Gestão ajustam"  on public.diaria_valores;

create policy "diárias: administrativo e Gestão ajustam" on public.diaria_valores
  for update to authenticated
  using (public.eh_administrativo() or public.eh_gestor())
  with check (public.eh_administrativo() or public.eh_gestor());

comment on table public.hoteis is
  'Hotéis e pousadas por município, com a diária combinada. Leitura para qualquer usuário ativo (a logística escolhe daqui); escrita do administrativo (quem opera) e da Gestão (quem supervisiona).';
comment on table public.diaria_valores is
  'Valor de referência da diária de alimentação. Leitura para qualquer usuário ativo; ajuste do administrativo e da Gestão.';


-- ═══════════════════════════════════════════════════════════════════════
--  UM ACESSO POR PESSOA
--
--  Juliana Vicente tinha DOIS acessos ativos, mesmo nome e mesmo cargo
--  (`juliana` e `juliana.colab`). Como o login tem um campo só e é a SENHA
--  que identifica a pessoa, dois acessos são duas senhas para a mesma
--  pessoa — e quais poderes ela teria dependia de qual senha digitasse.
--
--  Nenhum dos dois lidera projeto, abriu ou aprovou solicitação, então
--  desativar não desfaz vínculo nenhum. DESATIVAR e não apagar: `ativo =
--  false` barra o login e preserva a história se o id aparecer em algum
--  registro.
-- ═══════════════════════════════════════════════════════════════════════
update public.perfis set ativo = false where usuario = 'juliana.colab';


-- ═══════════════════════════════════════════════════════════════════════
--  CONFERÊNCIA
-- ═══════════════════════════════════════════════════════════════════════
select papel, count(*) as acessos, string_agg(nome, ', ' order by nome) as quem
  from public.perfis
 where ativo
 group by papel
 order by papel;
