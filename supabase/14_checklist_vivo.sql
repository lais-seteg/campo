-- ═══════════════════════════════════════════════════════════════════════
--  14 · O CHECKLIST VIVO: CADA UM ASSINA NO SEU ACESSO
--
--  Rode depois de 13_catalogo_e_hospede.sql.
--
--  ── O QUE MUDA NO FLUXO ──
--
--  Antes, a conferência era UM ato: quem estava no balcão abria o modal,
--  marcava os itens, e as DUAS assinaturas eram desenhadas no mesmo
--  aparelho, na mesma transação. Funciona quando as duas pessoas estão
--  lado a lado — e prova pouco: as duas assinaturas saem do mesmo dedo, no
--  mesmo celular, sem nada dizendo quem era quem.
--
--  Agora a assinatura é ATO PRÓPRIO, e de quem assina:
--
--    · o ADMINISTRATIVO assina entrando no acesso dele;
--    · o SOLICITANTE (ou quem está na equipe do campo) assina no dele.
--
--  Cada linha guarda `usuario_id` e `usuario_nome` de quem estava logado —
--  colunas que a tabela já tinha e que ninguém preenchia. É isso que faz a
--  assinatura valer como identificação, e não só como desenho.
--
--  A ORDEM passa a ser: marcar os itens → os dois assinam → registrar.
--  O registro (que move o estoque) exige as duas assinaturas do momento
--  presentes. Sem isso, a baixa aconteceria com uma folha em branco.
--
--  ── E A ÁREA EDITÁVEL ──
--
--  `solicitacoes.checklist_observacoes`. É a parte "editável igual à ordem
--  de compra" — com uma diferença deliberada: TEXTO, não HTML.
--
--  A Ordem de Compra do SGC é um documento CONGELADO: emitida uma vez, o
--  HTML editado é salvo, e a partir dali ela é papel. O checklist não pode
--  ser assim — ele é validado duas vezes e os quadradinhos dele são o que
--  move o estoque. Documento congelado aqui passaria a mentir sobre o
--  material: um X escrito à mão no HTML não dá baixa em nada.
--
--  Então a estrutura continua sendo GERADA (e viva), e o que se edita são
--  as observações. Como o que se escreve ali é frase e não tabela, texto
--  puro basta — e dispensa o sanitizador de HTML que a OC precisou ter,
--  com a superfície de XSS persistente que vem junto.
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
--  A ÁREA EDITÁVEL DO CHECKLIST
-- ═══════════════════════════════════════════════════════════════════════
alter table public.solicitacoes
  add column if not exists checklist_observacoes text;

comment on column public.solicitacoes.checklist_observacoes is
  'Observações livres que saem impressas no checklist. Texto e não HTML: a estrutura da folha é gerada pelo sistema, e o que se escreve aqui é frase — texto puro dispensa sanitizador e a superfície de XSS que vem com ele.';


-- ═══════════════════════════════════════════════════════════════════════
--  QUEM PODE ASSINAR COMO PRESTADOR
--
--  O prestador é quem RECEBE o material e responde por ele em campo. Duas
--  portas, porque as duas descrevem a mesma pessoa em situações
--  diferentes:
--
--    · quem ABRIU o pedido (`solicitante_id`) — o caso do "solicitante
--      pegar o material";
--    · quem está na EQUIPE do campo, casado pelo nome do acesso. A equipe
--      é digitada como texto (nem todo mundo que vai a campo tem login),
--      então o casamento é por nome — e é por isso que ele não pode ser a
--      única porta.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.pode_assinar_como_prestador(p_solicitacao uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1 from public.solicitacoes s
     where s.id = p_solicitacao
       and s.solicitante_id = (select auth.uid())
  ) or exists (
    select 1 from public.solicitacao_equipe e
     where e.solicitacao_id = p_solicitacao
       and upper(btrim(e.colaborador)) = upper(btrim(coalesce(public.nome_atual(), '')))
       and coalesce(public.nome_atual(), '') <> ''
  )
$$;

revoke all    on function public.pode_assinar_como_prestador(uuid) from public, anon;
grant  execute on function public.pode_assinar_como_prestador(uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
--  ASSINAR — UM ATO, DE UMA PESSOA
--
--  Insert-only, como já era: uma assinatura por momento e papel, sem update
--  e sem delete pelo aplicativo. Assinatura que se reescreve não prova
--  nada.
--
--  A Devolução não pode ser assinada antes de a entrega existir: assinar a
--  volta de material que não saiu é registro falso, e a folha impressa não
--  tem como distinguir isso depois.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.assinar_conferencia(
  p_solicitacao uuid,
  p_momento text,
  p_imagem text,
  p_nome text default null
) returns uuid
language plpgsql security definer set search_path to ''
as $function$
declare
  v_papel text;
  v_status text;
  v_entrega date;
  v_nome text;
  v_id uuid;
begin
  if not public.eh_usuario_ativo() then
    raise exception 'Sem permissão para assinar.';
  end if;
  if p_momento not in ('Retirada', 'Devolução') then
    raise exception 'Momento inválido: %. Use Retirada ou Devolução.', p_momento;
  end if;
  if p_imagem is null or length(p_imagem) < 200 then
    raise exception 'A assinatura precisa ser desenhada no quadro.';
  end if;

  select s.status, s.entrega_data into v_status, v_entrega
    from public.solicitacoes s where s.id = p_solicitacao;
  if not found then
    raise exception 'Solicitação não encontrada.';
  end if;
  if v_status in ('Cancelada', 'Recusada') then
    raise exception 'A solicitação está % — não há o que assinar.', v_status;
  end if;
  if p_momento = 'Devolução' and v_entrega is null then
    raise exception 'A entrega ainda não foi registrada: não há devolução a assinar.';
  end if;

  -- ── O PAPEL NÃO É ESCOLHIDO, É DEDUZIDO ──
  -- Quem chama não diz em que papel assina: o banco decide a partir de quem
  -- é. Deixar o cliente escolher permitiria a uma pessoa assinar as duas
  -- linhas, que é exatamente o que esta mudança existe para impedir.
  if public.eh_administrativo() or public.eh_direcao() then
    v_papel := 'Administrativo';
  elsif public.pode_assinar_como_prestador(p_solicitacao) then
    v_papel := 'Prestador';
  else
    raise exception
      'Você não está nesta solicitação. Assina a retirada quem a abriu ou quem está na equipe do campo; do outro lado, o administrativo.';
  end if;

  v_nome := upper(btrim(coalesce(nullif(btrim(coalesce(p_nome, '')), ''), public.nome_atual(), '')));
  if v_nome = '' then
    raise exception 'Informe o nome de quem assina.';
  end if;

  insert into public.solicitacao_assinaturas
        (solicitacao_id, momento, papel, nome, imagem, usuario_id, usuario_nome)
  values (p_solicitacao, p_momento, v_papel, v_nome, p_imagem,
          (select auth.uid()), public.nome_atual())
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'A assinatura de % (%) já foi registrada — assinatura não se reescreve.',
      v_papel, p_momento;
end;
$function$;

revoke all    on function public.assinar_conferencia(uuid, text, text, text) from public, anon;
grant  execute on function public.assinar_conferencia(uuid, text, text, text) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
--  QUEM JÁ ASSINOU O QUÊ
--
--  A tela precisa saber, antes de mostrar o quadro: já existe assinatura
--  deste papel? e EU posso assinar qual? Sem isso, a pessoa desenha o
--  traço para ouvir depois que já havia assinatura.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.situacao_das_assinaturas(p_solicitacao uuid)
returns table(
  momento text,
  adm_assinada boolean,
  prestador_assinada boolean,
  eu_assino text
)
language sql stable security definer set search_path to ''
as $$
  select m.momento,
         exists (select 1 from public.solicitacao_assinaturas a
                  where a.solicitacao_id = p_solicitacao
                    and a.momento = m.momento and a.papel = 'Administrativo'),
         exists (select 1 from public.solicitacao_assinaturas a
                  where a.solicitacao_id = p_solicitacao
                    and a.momento = m.momento and a.papel = 'Prestador'),
         case when public.eh_administrativo() or public.eh_direcao() then 'Administrativo'
              when public.pode_assinar_como_prestador(p_solicitacao) then 'Prestador'
         end
    from (values ('Retirada'), ('Devolução')) as m(momento)
   where public.eh_usuario_ativo()
$$;

revoke all    on function public.situacao_das_assinaturas(uuid) from public, anon;
grant  execute on function public.situacao_das_assinaturas(uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
--  CONFERÊNCIA: NÃO REGISTRA SEM AS DUAS ASSINATURAS
--
--  As funções de entrega e devolução ganham a mesma guarda. É aqui e não
--  na rota porque é aqui que o estoque se move: a regra tem de valer
--  também para quem chamar a função por outro caminho.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.exigir_assinaturas(p_solicitacao uuid, p_momento text)
returns void language plpgsql stable security definer set search_path to ''
as $function$
declare v_faltam text[] := array[]::text[];
begin
  if not exists (select 1 from public.solicitacao_assinaturas a
                  where a.solicitacao_id = p_solicitacao
                    and a.momento = p_momento and a.papel = 'Administrativo') then
    v_faltam := v_faltam || 'do administrativo';
  end if;
  if not exists (select 1 from public.solicitacao_assinaturas a
                  where a.solicitacao_id = p_solicitacao
                    and a.momento = p_momento and a.papel = 'Prestador') then
    v_faltam := v_faltam || 'de quem recebe o material';
  end if;

  if array_length(v_faltam, 1) > 0 then
    raise exception
      'Falta a assinatura % para registrar a %. Cada um assina no próprio acesso, no checklist.',
      array_to_string(v_faltam, ' e a '), lower(p_momento);
  end if;
end;
$function$;

revoke all    on function public.exigir_assinaturas(uuid, text) from public, anon;
grant  execute on function public.exigir_assinaturas(uuid, text) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
--  CONFERÊNCIA
-- ═══════════════════════════════════════════════════════════════════════
select p.proname, pg_get_function_identity_arguments(p.oid) as argumentos
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('assinar_conferencia', 'situacao_das_assinaturas',
                     'pode_assinar_como_prestador', 'exigir_assinaturas')
 order by 1;
