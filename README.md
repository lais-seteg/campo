# Solicitação de Campo · Seteg

Versão digital do formulário **FORMULARIO_SOLICITACAO_ADMINISTRATIVA_FINANCEIRA_CODIGO CLOCKIFY_REV00.xlsx**
(está em `doc/`), mais o que a operação de campo precisa e o papel não tinha: calendário de
equipe, controle de custo previsto × real, SST, assinatura digital e **reserva de material no
Controle de Estoque**.

Mesmo design e mesmo login do **Controle de Estoque** — os dois sistemas rodam sobre o **mesmo
projeto Supabase**.

**Next.js 14 (App Router) + TypeScript `strict`**, sobre o Supabase, na mesma estrutura de
segurança e modularidade do `clockrview`. Foi uma migração: até a v2 isto era um site estático
com o navegador falando direto com o banco. Ver **[Arquitetura e segurança](#arquitetura-e-segurança)**
para o que mudou e por quê — o comportamento e as regras de negócio são os mesmos.

## O que o sistema cobre

O formulário em papel tem três abas, e é delas que sai a base da tela:

| Aba da planilha | Vira no sistema |
|---|---|
| **FINANCEIRO** | Solicitação do tipo *Financeiro*: despesas com prestação de contas (transporte, combustível, outros) com subtotais, dados da transferência e diárias de alimentação pagas mediante recibo (Seteg e temporário). |
| **ADMINISTRATIVO** | Solicitação do tipo *Administrativo*: veículo (condutor, retirada e entrega), hospedagem (uma linha por cidade, com **quem** dorme nela — campo que passa por mais de uma base dorme em mais de um lugar) e equipamento requisitado para campo. |
| **TECNICOS** | Lista técnico ↔ código Clockify, oferecida como sugestão no campo "Código Clockify". |

O quadro **CONFERÊNCIA** do papel (ENT. · TESTE · DEV. · TESTE · AVARIA?, com data e as
assinaturas do administrativo e do prestador) virou a aba **Conferência**: registra a entrega
do equipamento na saída e a devolução na volta, item a item — e agora **movimenta o estoque**.

### Telas

- **Solicitações** — lista com filtros (tipo, status, status de curso, busca), paginação e exportação CSV.
- **Calendário** — equipe × projeto × data: quem está em campo, onde e quando.
- **Aprovações** — a fila do líder. Só aparece para quem lidera algum projeto (e para a Direção).
- **Logística** — fechar veículo, hotel e reserva de material do que já foi aprovado.
- **Conferência** — entrega e devolução dos equipamentos que foram para campo.
- **Cadastros** — hotéis e pousadas por município e o valor de referência da diária.
- **Avarias** — relatório de avaria com custo estimado e custo real.
- **Painel** — aguardando líder, logística a fechar, em campo, previsto × real, SST conforme, custo de avaria e a distribuição do status de curso.
- **Projetos** — cadastro de projetos e líderes. Só aparece para a Direção.
- **Organograma** — cadastro dos colaboradores da empresa, e é dele que sai quem pode liderar
  projeto. Última aba do menu, e só aparece para a Direção — que, diferente das outras telas, é
  também a única que pode **ler**.

O acesso da **Direção é total**: ela vê todas as abas acima, as mesmas do administrativo e de
quem abre pedido, mais Projetos e Organograma, que são só dela. Ela cai no **Painel** ao entrar,
porque a pergunta que ela faz ao chegar é a do todo — mas a lista de pedidos, a logística, a
conferência e os cadastros estão todos no menu dela.

Cadastrar **projeto** continua sendo exclusividade da Direção: o administrativo cadastra hotel e
ajusta a diária, e não toca em `projetos`. Quem barra não é o menu, é a política do banco —
`projetos` só aceita escrita de `eh_direcao()`.

## Papéis

| Papel | O que só ele faz | Vê valor real × previsto |
|---|---|---|
| **Direção** | cadastra **projeto e líder** (aba Projetos) e o **organograma**; aprova campo quando o líder não está | sim |
| **Administrativo** | cadastra hotel, ajusta o valor de referência da diária, fecha a logística e **libera a folga entre campos** | sim |
| **Financeiro** | — (não cadastra e não aprova; existe para acompanhar o dinheiro) | sim |
| **Colaborador** (`tecnico`) | abre solicitação, edita, registra conferência | só se liderar projeto |

O papel **`gestor`** continua existindo no banco porque `perfis` é compartilhada com o Controle
de Estoque, mas **nenhum acesso o tem** desde `supabase/09` — e ele não vê valor.

**Ver valor é de quem responde por ele ou opera com ele**: líder de projeto (nos projetos
dele), Direção, administrativo e financeiro. O administrativo entrou nessa lista no `09`,
invertendo o que o `07` decidira: quem fecha veículo, hotel e material é justamente quem precisa
saber se o campo está estourando o previsto — descobrir no fechamento é tarde para trocar de
hotel ou de locadora.

Acima disso há um **veto por pessoa**, `perfis.ve_valores`. Ele nega, e é conferido *antes* do
papel: em `false`, a pessoa não vê valor mesmo que o papel dela veja, e isso vale até para um
líder ou para a Direção. Existe porque houve um pedido sobre alguém e não sobre uma função —
criar um sexto papel para abrigar a exceção transformaria uma decisão de gente numa categoria
permanente do sistema. Hoje um acesso está vetado: **Jonatas Rodrigues**.

**Ser líder não é papel**: é ser o líder de alguma linha de `projetos`. Um colaborador pode
liderar um projeto e não liderar outro — por isso a pergunta que o sistema faz nunca é "esta
pessoa é líder?", e sim "esta pessoa é líder **deste** projeto?".

Quem **pode se tornar** líder é outra pergunta, e ela se responde no organograma: **estar
cadastrado basta**. Todo colaborador ativo é candidato a líder no cadastro de projetos — não há
autorização por pessoa a conceder. A única condição é ter **acesso ao sistema**, e essa não é
uma escolha de produto: liderar é aprovar campo, e a aprovação compara `auth.uid()` com
`projetos.lider_id`, então quem não entra no sistema não tem como aprovar.

## Organograma (só a Direção)

Aba **Organograma**, tabela `colaboradores`. É o cadastro de gente que o sistema não tinha:
havia `perfis` — que é a lista de **quem entra** no sistema, com FK para `auth.users`, onde
cadastrar alguém significa criar um login — e uma constante de dez nomes chumbada no código.

Colaborador entra aqui **com ou sem acesso** ao sistema: quem vai a campo não precisa de login.
Quem também usa o sistema fica ligado ao acesso por `perfil_id`, e é essa ligação que permite
autorizá-lo a liderar projeto.

`projetos.lider_id` continua apontando para `perfis`, e é de propósito: é o id que a RLS e
`aprovar_solicitacao_lider()` conferem contra `auth.uid()`. O organograma decide **quem entra na
lista** de candidatos; o vínculo que dá poder de aprovar é o mesmo de sempre.

Leitura e escrita são de `eh_direcao()`. Diferente de `hoteis` — que todo mundo lê porque a
logística escolhe da lista —, cargo, setor, contato e vínculo da empresa inteira não são dado de
navegação.

A Direção é acima da Gestão, então `eh_gestor()` passou a responder `true` para os dois. Isso
vale também no **Controle de Estoque**, que usa a mesma função: a Direção exclui item lá
também. Papel de cima com menos poder que o de baixo não faria sentido.

## O fluxo, e quem aprova

```
Aguardando aprovação → Aprovada → Logística confirmada → Em campo → Finalizada
      (líder)        (administrativo)   (conferência)   (conferência)

Recusada — pelo líder, com motivo    ·    Cancelada — a qualquer momento, com motivo
```

Quem aprova é o **líder do projeto** escolhido na solicitação. Não é a aprovação da Gestão que
foi retirada: aquela autorizava gasto; esta responde outra pergunta, de outra pessoa — *este
campo é do escopo do meu projeto?*.

- **Escolher o projeto é obrigatório.** É ele que diz quem aprova; o banco recusa pedido sem
  projeto, e recusa projeto sem líder. Sem nenhum projeto cadastrado, ninguém abre solicitação
  — é a Direção que destrava isso.
- **Quem pede sendo o líder não espera por si mesmo**: o pedido nasce `Aprovada`.
- **A Direção também aprova.** Líder de férias não pode travar o campo inteiro.
- **Recusar solta a reserva**, como cancelar: material preso num campo que não vai acontecer é
  material que falta em outro.
- **Logística só depois de aprovado.** Fechar hotel e carro de um campo que o líder ainda não
  validou é gastar antes da hora.
- **Equipamento não sai antes da aprovação.** A conferência de entrega recusa pedido
  `Aguardando aprovação`.

Quatro estados não saem de edição direta: `Aprovada`/`Recusada` são o ato do líder e passam
pela função que confere quem está chamando; `Em campo`/`Finalizada` são consequência da
conferência, que é quem mexe no saldo do estoque. Deixar um `update` qualquer declarar "em
campo" faria o estoque e a solicitação contarem histórias diferentes.

## Cadastro de projetos (só a Direção)

Aba **Projetos**. Cada projeto tem **Cliente**, **Projeto**, **Líder** (escolhido na lista que
vem do **organograma** — quem a Direção autorizou a liderar, ativo e com acesso ao sistema;
texto livre não aprova nada), **Programas desenvolvidos** (um campo por
programa: Fauna, Flora, Ambiental, Qualidade do Ar… a lista muda a cada contrato) e o
**previsto por dia** que alimenta o previsto × real.

Os programas são digitados um a um — a **setinha** (ou o Enter) fecha o programa e já abre a
linha seguinte, a lixeira remove. No banco eles continuam numa coluna de texto só, separados
por vírgula: é assim que os projetos antigos estão gravados e é isso que a busca da aba e a
exportação leem.

Esconder a aba não é a barreira — quem barra é a política do banco: só `direcao` grava em
`projetos`. A aba escondida evita o uso casual; a RLS impede o resto.

Excluir projeto usado desfaz o vínculo das solicitações antigas *e* apaga de quem era a
aprovação. O caminho certo é marcar como **inativo**: preserva a história e tira o projeto da
lista de quem vai pedir.

## Integração com o Clockify

O campo **Código Clockify** é preenchido a partir dos projetos reais do workspace, e não mais
digitado no escuro. A lista é buscada pelo próprio app, no navegador — mesmo caminho do
**sgc-seteg**, que consome este mesmo workspace.

A chave fica em **variável de ambiente**, lida só pelo servidor. O modelo versionado é o
`.env.example` — `cp .env.example .env.local` e preencher:

| Variável | | |
|---|---|---|
| `CLOCKIFY_API_KEY` | opcional | Clockify → Preferences → Advanced → API key |
| `CLOCKIFY_WORKSPACE_ID` | opcional | só se a conta tiver mais de um workspace; em branco, usa o primeiro |

> **A chave saiu do navegador.** Até a v2 ela vivia no `env.js`, carregado pelo `index.html`, e
> viajava no cabeçalho `X-Api-Key` de uma requisição feita **pelo navegador** — aparecia para
> quem abrisse o DevTools no site publicado. O próprio `env.example.js` dizia isso com todas as
> letras, e dizia também o que faltava: *"tirá-la do navegador exigiria uma função no servidor
> repassando a chamada"*. Essa função existe agora: `lib/clockify.ts`, atrás de
> `GET /api/clockify/projetos`.

Consequência direta: `api.clockify.me` **saiu** do `connect-src` da CSP. O navegador só fala
com o próprio app.

Sem a chave, o campo fica sem sugestões e mostra o motivo embaixo — e só isso: **o código
continua podendo ser digitado à mão** e nada mais no sistema depende disso. A rota responde
`200` com a lista vazia e o motivo, em vez de erro: integração fora do ar não pode virar tela
quebrada.

O código do Clockify é **do projeto**, e fica no cabeçalho da solicitação. A equipe **não** tem
um campo por pessoa: pedir o mesmo dado uma vez por linha é onde ele sai diferente. A coluna
`solicitacao_equipe.codigo_clockify` continua no banco com o que já foi gravado, e nada novo é
escrito nela.

A leitura dos projetos é a mesma do SGC: nome no padrão `#CODIGO (Nome do empreendimento)`
vira **código** (o que entra no campo, sem o `#`) e **nome** (a dica na lista), e projeto cujo
nome começa com `CANCELADO` ou `FINALIZADO` fica de fora. Hoje isso dá 58 projetos ativos de
268 no bruto, todos no padrão.

## Integração com o Controle de Estoque

**Material pedido para campo fica indisponível nas datas daquele campo.** Não é baixa — é
compromisso. Equipamento de campo é empréstimo, e o formulário em papel já dizia isso ao ter
entrega e devolução; o saldo do estoque só muda quando o item fisicamente sai.

| Momento | Efeito no estoque |
|---|---|
| Solicitação salva | **Reserva** no período (o saldo não muda) |
| Entrega (ENT.) | **Saída** vinculada à solicitação; reserva vira *Em campo* |
| Devolução (DEV.) | **Entrada** vinculada à solicitação; reserva vira *Devolvido* |
| Avaria com fornecedor informado | Abre **manutenção** do bem no Controle de Estoque |
| Cancelamento | Reserva liberada; material volta a ficar disponível |

**A reserva pega um dia a mais de cada lado.** O material fica indisponível também na véspera e
no dia seguinte ao período do campo — porque o equipamento não se teletransporta: ele é separado
e conferido antes de sair, viaja, volta e só então é conferido de novo. Sem essa folga, dois
campos colados (um terminando dia 12, outro começando dia 13) disputavam o mesmo medidor como se
a devolução da manhã e a retirada da tarde fossem o mesmo instante — e quem descobria isso era a
equipe do segundo campo, na hora de sair. Na prática: é preciso **ao menos um dia livre entre
dois campos** que usam o mesmo item.

A folga é regra de **disputa**, não de dado: `item_reservas` continua gravando as datas reais do
campo (são elas que o calendário, o checklist e a conferência mostram), e quem aplica a margem é
`item_comprometido()` — a única função do sistema que compara datas de reserva, e por isso o
único lugar onde a regra vive. O tamanho da folga está em `margem_reserva_dias()`, para mudar num
lugar só.

### A folga é do administrativo, não do sistema

A folga é **padrão, não lei**: às vezes o campo anterior volta de manhã e o próximo sai à tarde,
do mesmo galpão. Quem sabe disso é o administrativo, e é dele a decisão.

Por isso existem **dois motivos** para um item não poder sair, e eles não se parecem:

| | O que é | Quem resolve |
|---|---|---|
| **Conflito real** | outro campo está com o item **nas mesmas datas** | ninguém — nem a Direção. Nada é gravado |
| **Só a folga** | o item está livre nas datas do campo, e o que atrapalha é a véspera ou o dia seguinte de outro campo | o **administrativo** (e a Direção), item a item |

Quando esbarra só na folga, **o pedido é salvo assim mesmo** e a linha do equipamento fica
*aguardando liberação* — gravada, visível, sem reserva. Era essa a peça que faltava: um pedido que
não salva não tem o que ser liberado, e a conversa acontecia fora do sistema. O administrativo vê
a pendência no detalhe da solicitação e libera (a reserva nasce na mesma ação, com o nome dele no
histórico) ou não libera — e o campo segue sem aquele item, o que é diferente do pedido não
existir.

Como a reserva só nasce na liberação, duas pessoas aguardando o mesmo item não travam uma a
outra: quem for liberado primeiro reserva primeiro, e a segunda liberação reconfere o saldo e
recusa se não couber. Estar *aguardando* não é estar na fila — é não ter nada guardado.

O estado "aguardando" é **derivado**, não uma coluna: é a linha com item de catálogo, ainda não
entregue e sem reserva viva. Como conflito real nem chega a salvar e o que cabe é reservado na
hora, essa é a única maneira de uma linha ficar sem reserva. Estado derivado não sai do lugar
quando alguém esquece de atualizá-lo.

Duas solicitações que se cruzam no calendário disputam o mesmo saldo: **quem reserva primeiro
leva**, e a segunda ouve exatamente o que falta e em que datas. Por isso a conferência de saldo
mora no **banco** e não no navegador — duas pessoas salvando ao mesmo tempo não podem furar o
estoque. As funções travam as linhas do catálogo antes de conferir, e são **idempotentes**:
retry de rede não baixa duas vezes.

No formulário, a lista de equipamentos mostra **o que está disponível nas datas do campo**, e
não o saldo do estoque. São coisas diferentes: um medidor que está na prateleira hoje pode já
estar comprometido com outro campo na semana que vem. Item em manutenção aparece na lista com
disponível zero, em vez de sumir — quem está pedindo precisa saber por que não pode levar.

Nada disso é um `update itens set estoque_atual = ...` daqui: lá a movimentação nasce de
*trigger*, e é ele que registra a Saída e a Entrada. O que estas funções fazem é mudar o saldo
e, em seguida, escrever na movimentação recém-criada de qual solicitação ela veio.

### Avaria e manutenção

A manutenção no Controle de Estoque só é aberta daqui **quando o fornecedor do reparo foi
informado** na devolução. Lá, `em_manutencao` exige fornecedor *e* justificativa, e inventar um
fornecedor só para satisfazer a restrição seria falsear o registro. Sem fornecedor, o item
volta disponível e a avaria fica no relatório aguardando encaminhamento.

## Custo: previsto × real

O **previsto** é o que o líder informa; o **real** é o que foi gasto. Quatro linhas de cada
lado: veículo, hospedagem, alimentação e outros.

- O **cadastro de projetos** guarda o previsto **por dia** (aluguel de veículo, diária de hotel
  e alimentação por pessoa). O formulário multiplica pelos dias do campo — e pela equipe, na
  alimentação — e oferece como **sugestão**, com um botão para aplicar. Sugestão, não imposição.
- O **cadastro de hotéis** guarda a diária combinada com a casa; escolher o hotel traz o valor.
- O **valor real do transporte** vem com a **locadora** (Movida, Localiza, Unidas ou Outros),
  contrato/reserva e placa. A locadora é lista fechada porque é sobre ela que se negocia
  contrato: em texto livre, "Movida" viraria cinco grafias e o gasto por locadora não somaria.
  Com "Outros", dizer qual passa a ser obrigatório.

O **status de curso** compara os dois: `Abaixo`, `Dentro` ou `Acima do previsto`, com **faixa
de tolerância de 5%**. Sem faixa, um combustível de dez reais jogaria todo campo para "acima" ou
"abaixo" e o indicador não diria mais nada. Totais, desvio e status de curso são **calculados
por trigger**, nunca digitados — a mesma escolha do Status e do Valor Total no estoque.

### Diária de alimentação

**R$ 55,00 com pernoite** e **R$ 35,00 sem pernoite**, na tabela `diaria_valores`. Fica em
tabela e não no código por dois motivos: mudar o valor é decisão administrativa e não deploy, e
o valor de referência precisa estar ao lado do valor pago para a diferença aparecer. Escolher o
tipo de diária preenche o valor sozinho; o campo continua editável, e uma diária fora da
referência fica **marcada em laranja** — a diferença passa a ser escolhida, não acidental.

Só a Gestão altera os valores de referência (aba Cadastros → Valor da diária).

## SST no pedido de campo

**Só no pedido administrativo.** SST é sobre o que vai a campo — EPI, equipe exposta, risco do
cliente. Pedido financeiro é prestação de contas (despesa, diária, dados de transferência) e não
tira ninguém do escritório; perguntar segurança do trabalho ali era coletar duas vezes o que o
administrativo já responde, e a segunda resposta é a que ninguém confere. O envio zera o SST no
financeiro de propósito: sem isso, o padrão "se aplica" gravaria todo pedido financeiro como
campo com SST e o Painel contaria um número errado — que é pior do que número nenhum.

Não é cadastro de pessoa: é a **conferência que o líder faz antes de sair**, e que sai impressa
no checklist assinado. Seis itens — APR, Permissão de Trabalho, DDS, treinamentos (NR), ASO e
EPIs — mais a lista de **EPIs que vão com a equipe** (com CA e conferência item a item).

A **identificação** é calculada pelo banco: `Conforme` só com a conferência inteira fechada,
`Pendente` enquanto falta alguma, `Não aplicável` quando o campo não exige SST. Meia conferência
não é conferência. O painel conta quantos campos saíram com SST fechado.

## Checklist com assinatura digital

Toda solicitação com equipamento emite um **checklist** para imprimir e levar junto. A mesma
folha é validada duas vezes: **na retirada** (conferir e testar o que está saindo) e **na
devolução** (conferir se tudo voltou e em que estado).

As quatro assinaturas do papel — administrativo e prestador, nos dois momentos — deixam de ser
um nome digitado e passam a ser **o traço desenhado na tela**: no celular, com o dedo, na hora
da conferência. É um `<canvas>` com eventos de ponteiro, sem biblioteca — a CSP do site não
abre para CDN por causa de um rabisco, e o mesmo código serve para dedo, caneta e mouse.

A assinatura **entra e não sai**: uma por momento e papel, sem update e sem delete para o
aplicativo. Assinatura que se reescreve não prova nada. A folha continua servindo para assinar
à mão — campo sem sinal existe —, e a linha da caneta só é substituída pela imagem quando ela
existe.

Na devolução registrada pelo sistema, **item que não voltou mantém a solicitação em campo**: o
status só vai para *Finalizada* quando todos os equipamentos foram conferidos de volta, e a
tela diz o que ficou faltando.

## Edição e acréscimo

Pedido de campo muda depois de aberto: a data anda, o hotel troca, entra mais um equipamento.

- **Editar** reabre o mesmo formulário carregado. Não se edita o que terminou — pedido
  Finalizado ou Cancelado é registro, e reescrever registro apaga a história em vez de
  corrigi-la.
- **Equipamento já entregue não sai pela edição**: ele está fisicamente com a equipe, e a linha
  é a obrigação de devolver. A edição reescreve só o que ainda não saiu, e a tela avisa quantos
  itens ficaram de fora por isso.
- **Acrescentar equipamento** é uma ação própria, e não uma linha nova no formulário: material
  novo disputa as datas como qualquer outro. A função no banco reserva na mesma transação — se
  não couber, ela diz o que falta e **nada é gravado**.
- Toda alteração de cabeçalho e todo acréscimo ficam em `solicitacao_alteracoes`, escritos por
  *trigger*. O detalhe da solicitação mostra o histórico.

## Calendário

Um campo não é um ponto no tempo, é um intervalo: aparece em **todos** os dias entre o início e
o fim. A pergunta que a coordenação faz é "quem está fora na quinta?", e não "quem pediu na
quinta?".

Calendário à esquerda com um pontinho **por status** presente no dia (não por evento); lista à
direita com projeto, período, destino e equipe. Sem dia escolhido, a lista é do mês inteiro;
clicar de novo no mesmo dia volta para o mês. Filtros por projeto e por pessoa. O CSV sai como
**uma linha por pessoa por campo** — é assim que se confere escala.

Mesmo desenho do calendário de manutenção do Controle de Estoque, de propósito: é a mesma
leitura.

## Como rodar

```bash
npm install
cp .env.example .env.local     # e preencher
npm run dev                    # http://localhost:3000
```

Três comandos a mais: `npm run build` (o que o Vercel roda), `npm start` (servir o build) e
`npm run typecheck` (o TypeScript sem gerar nada).

`SUPABASE_URL` e `SUPABASE_ANON_KEY` apontam para o mesmo projeto Supabase do Controle de
Estoque e usam a chave **publishable** — a segurança vem da RLS, não do sigilo da chave. A
senha de acesso é a mesma: quem entra no estoque entra aqui.

`SESSION_SECRET` é novo e **obrigatório**: é ele que assina o cookie de sessão. Sem ele a
aplicação se recusa a subir, de propósito — subir assinando com chave vazia deixaria qualquer
um forjar um cookie de qualquer papel, Direção inclusive. Gere com:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**No deploy (Vercel):** as mesmas variáveis vão no painel do projeto. Não há mais arquivo de
configuração a copiar à mão no que é publicado — era essa a ressalva do `env.js`, e ela deixou
de existir.

### A função roda em São Paulo, e isso não é detalhe

`vercel.json` fixa `"regions": ["gru1"]`. É a linha mais importante do deploy, e o motivo é
geografia: o projeto Supabase está em **`sa-east-1` (São Paulo)** e a equipe está no Ceará.

No padrão do Vercel (`iad1`, Washington), cada navegação fazia o caminho

```
Ceará → São Paulo (borda) → WASHINGTON (função) → São Paulo (banco) → Washington → São Paulo → Ceará
```

e **cada** consulta do carregamento atravessava o Atlântico duas vezes. O `x-vercel-id` denunciava
isso em toda resposta: `gru1::iad1::…` — recebido em São Paulo, executado em Washington. Da máquina
de quem usa, o banco responde em ~26ms; era o código que estava longe dele, não o contrário.

Se algum dia o projeto Supabase mudar de região, esta linha muda junto. Elas têm de andar
emparelhadas: função longe do banco é o tipo de lentidão que nenhuma otimização de consulta
compensa.

## Arquitetura e segurança

Até a v2 isto era um site estático: `index.html` + `script.js`, com o navegador falando direto
com o Supabase. A v3 é **Next.js (App Router) + TypeScript**, na mesma estrutura do
`clockrview`. O que mudou, e por quê:

| | Antes | Agora |
|---|---|---|
| **Quem fala com o Supabase** | o navegador | o servidor (`lib/supabaseServidor.ts`) |
| **Onde mora a sessão** | `localStorage` (ao alcance de XSS) | cookie `httpOnly`, assinado (`lib/token.ts`) |
| **Chave do Clockify** | visível no DevTools | variável de ambiente, só no servidor |
| **`connect-src` da CSP** | `'self'` + supabase + clockify | `'self'` |
| **Validação de entrada** | no navegador, lendo o DOM | no servidor, antes de gravar (`app/api/**/validacao.ts`) |
| **Barreira de papel** | esconder a aba | `middleware.ts` → `exigirPapel()` → RLS |
| **Tipos** | nenhum | `lib/tipos.ts`, `strict` ligado |

**A RLS continua sendo a segurança.** O servidor consulta o banco com a chave publishable mais
o *access token da pessoa logada*, então `auth.uid()` responde quem é e toda política escrita
em `supabase/*.sql` vale exatamente como antes. A chave `service_role` **não** é usada em lugar
nenhum: ela ignoraria a RLS inteira, e o banco é compartilhado com um sistema que não fez essa
escolha.

**As três barreiras, e por que não são redundantes:**

1. `middleware.ts` — roda em Edge, não consulta o banco. Confere a assinatura do cookie e o
   papel contra `ROTAS_RESTRITAS`. É rápido e cobre a navegação inteira.
2. `lib/sessao.ts` — roda com o banco na mão. Revalida `perfis.ativo` e relê o papel. Um acesso
   desativado é barrado na primeira navegação, não daqui a sete dias.
3. A **RLS** e as funções do banco. Se as duas primeiras deixassem passar, o Postgres recusaria
   assim mesmo.

**O que continua sendo do banco, e não subiu para o servidor:** o código `SC-0001` (sequence),
o status (trigger), a autoria (`auth.uid()`), os totais, o desvio, o status de curso, a
identificação de SST, a reserva de material, a baixa e a entrada no estoque e o histórico de
alterações. Nada disso é calculado ou decidido no TypeScript — a camada nova é uma porta, não
uma segunda fonte da verdade.

## Banco de dados

> **Já aplicado** no projeto `gcaetcrywdadwhaqggxj` (o mesmo do Controle de Estoque), em
> 25/08/2026: `campo_01_solicitacoes`, `campo_02a…02e`, `campo_03a…03d`. Conferido: 9 tabelas
> novas, 12 funções, 3 papéis, fluxo de aprovação e 31 acessos. Os arquivos abaixo são a fonte
> da verdade e continuam idempotentes — rodá-los de novo não duplica nada.

**Nesta ordem**, no mesmo projeto Supabase do Controle de Estoque:

1. `supabase/01_solicitacoes.sql` — o formulário virado tabelas.
2. `supabase/02_campo_v2.sql` — cadastros, previsto × real, SST, reserva de material, avarias
   com custo, assinatura digital e histórico.
3. `supabase/04_direcao_e_aprovacao.sql` — o papel de Direção, projeto com líder de verdade e a
   aprovação do líder.
4. `supabase/05_ajustes_v3.sql` — prazo e escopo do projeto, gasto previsto por categoria,
   avaria somando no real.
5. `supabase/06_cadastros_do_administrativo.sql` — hotel e diária passam a ser do
   `administrativo`.
6. `supabase/07_quem_ve_dinheiro.sql` — valor é de quem responde por ele.
7. `supabase/08_organograma.sql` — o cadastro de colaboradores, e é dele que sai quem pode
   liderar projeto. Nasce com os **nomes** dos acessos ativos de `perfis`, cada um ligado ao seu
   acesso — e **sem cargo**, que é decisão de gente e se preenche na tela. Como todos vêm de
   `perfis`, todos já entram na lista de líderes do cadastro de projetos.
8. `supabase/09_direcao_nominal_e_valores.sql` — o veto por pessoa (`perfis.ve_valores`) e a
   regra nova de quem vê dinheiro: líder, Direção, administrativo e financeiro.
9. `supabase/10_desempenho.sql` — **por último**. Não muda quem pode o quê: tira a política de
   SELECT duplicada de sete tabelas (uma `FOR SELECT` + uma `FOR ALL` faziam o Postgres avaliar
   o mesmo predicado duas vezes por linha), passa esses predicados para `(select ...)` — que os
   executa uma vez por consulta em vez de uma por linha — e cria `projetos_lider_idx`, que serve
   ao `exists()` de `pode_ver_valores()`. **Rode-o de novo** se algum dia reaplicar o `01` ou o
   `02`: eles recriam as políticas `FOR ALL` que este arquivo desfaz.
10. `supabase/11_margem_de_reserva.sql` — a folga de um dia antes e depois na reserva de material
    (`margem_reserva_dias()`), aplicada dentro de `item_comprometido()`.
11. `supabase/12_liberacao_da_folga.sql` — a folga vira decisão do administrativo: separa conflito
    real de "só a folga", deixa o pedido nascer aguardando liberação e cria
    `liberar_folga_equipamento()`.
12. `supabase/13_catalogo_e_hospede.sql` — `catalogo_de_campo()` (a lista de equipamentos vinha
    **vazia** para 29 dos 33 acessos, ver abaixo) e a coluna `solicitacao_hospedagens.hospedes`.

**O catálogo de equipamentos não passa por `from("itens")`.** A política de SELECT de `itens` é do
Controle de Estoque e exige `eh_usuario_estoque()` — isto é, `perfis.acesso_estoque`. Lendo a
tabela direto, este sistema herdava essa exigência sem querer: só 4 dos 33 acessos ativos a tinham,
e para os outros 29 — **os dois da Direção e os 25 solicitantes entre eles** — o campo "Equipamento
requisitado" não tinha o que mostrar. Sem erro na tela: a RLS não recusa a consulta, devolve zero
linha. `catalogo_de_campo()` é `security definer` e pergunta `eh_usuario_ativo()`, que é a regra
certa aqui — quem está no sistema pode pedir equipamento, logo precisa ver o que existe. Era o
mesmo desenho que `itens_disponiveis_no_periodo()` já usava; `lerCatalogo` era a peça
inconsistente. Dar `acesso_estoque` a todos resolveria o sintoma e colocaria 29 pessoas dentro de
outro sistema.
9. `supabase/03_funcao_acesso.sql` — a função que cria acesso (sem senha nenhuma dentro).
   Depois dela, `supabase/03_acessos.sql` (**fora do Git**) cria os acessos com as senhas reais
   e destrói a função ao terminar.

`criar_acesso` é **destruída depois de cada uso**, e é por isso que ela não aparece na lista de
funções do banco: é `SECURITY DEFINER` e capaz de criar um acesso de Direção. Para criar ou
redefinir um acesso, recrie-a a partir do `03_funcao_acesso.sql`, chame-a e apague-a de novo.
A senha tem **mínimo de 8 caracteres** e precisa ser **única entre todos os acessos** — as duas
regras estão dentro dela.

Das duas, a que o login **depende** é a unicidade: como a pessoa digita só a senha, duas senhas
iguais deixariam o sistema sem saber quem entrou. O mínimo de 8 é política, não mecanismo.
Por isso existe **uma exceção**, criada por decisão da Direção: o acesso `eveline.mesquita` tem
senha de 7 caracteres, inserida direto (sem passar pela função) depois de conferida a ausência
de colisão. É a única, e a regra continua valendo para todo mundo.

Todos são idempotentes e terminam com uma consulta de conferência.

Nenhum dos dois recria o que já existe no projeto do estoque: `perfis`,
`identificar_acesso()`, `eh_gestor()`, `eh_usuario_ativo()`, `nome_atual()` e o catálogo
`itens` vêm de `ESTOQUE/supabase/01_schema.sql`.

Enquanto o `01` não rodar, o sistema entra, avisa na tela que a estrutura está pendente e
continua navegável. Enquanto o `02` não rodar, ele funciona **sem** reserva, calendário e
previsto × real — e diz isso, em vez de fingir.

### Tabelas

De `01`: `solicitacoes`, `solicitacao_equipamentos`, `solicitacao_hospedagens`,
`solicitacao_despesas`, `solicitacao_diarias`.

De `02`: `projetos`, `hoteis`, `diaria_valores`, `solicitacao_equipe`,
`solicitacao_sst_epis`, `item_reservas`, `solicitacao_avarias`, `solicitacao_assinaturas`,
`solicitacao_alteracoes`.

### Funções chamadas pela tela

| Função | Para quê |
|---|---|
| `itens_disponiveis_no_periodo(inicio, fim, ignorar)` | o catálogo visto pelas datas do campo |
| `item_comprometido(item, inicio, fim, ignorar, margem)` | quanto de um item já está comprometido — **único lugar que compara datas de reserva**. `margem` nula usa a folga padrão; `0` responde "há conflito **real** de datas?" |
| `margem_reserva_dias()` | o tamanho da folga antes e depois do campo (hoje, 1 dia) |
| `equipamentos_aguardando_folga()` | o que está gravado sem reserva, esperando o administrativo |
| `liberar_folga_equipamento(equipamento, liberar, motivo)` | o ato do administrativo: dispensa a folga daquele item e reserva na mesma transação |
| `reservar_equipamentos_solicitacao(id)` | reserva (ou refaz) o material do pedido |
| `liberar_reservas_solicitacao(id)` | solta o que estava reservado e não saiu |
| `registrar_entrega_solicitacao(...)` | conferência de saída + Saída no estoque |
| `registrar_devolucao_solicitacao(...)` | conferência de volta + Entrada + avarias |
| `acrescentar_equipamento_solicitacao(...)` | acréscimo com reserva na mesma transação |
| `remover_equipamento_solicitacao(id)` | tira do pedido o que ainda não saiu |
| `aprovar_solicitacao_lider(id, aprovar, motivo)` | o ato do líder: aprovar ou recusar |
| `eh_direcao()` · `eh_lider()` · `eh_lider_do_projeto(id)` | quem é quem, para as políticas e a tela |

`item_reservas` e `solicitacao_alteracoes` são **só leitura** para o aplicativo: quem escreve
nelas são essas funções, que rodam como dono e conferem saldo e datas antes. Deixar o navegador
inserir reserva à mão desfaria toda a garantia contra dois pedidos simultâneos furarem o
estoque.

## Estrutura

```
campo/
├─ app/
│  ├─ layout.tsx            html, tema e o provedor de avisos
│  ├─ globals.css           o style.css do estoque, com os caminhos de fonte ajustados
│  ├─ login/                a tela de entrada (fora do grupo que exige sessão)
│  ├─ (sistema)/            tudo que exige sessão — o parêntese NÃO entra na URL
│  │  ├─ layout.tsx         barra lateral + aviso de schema pendente
│  │  ├─ solicitacoes/      lista, detalhe, formulário, checklist
│  │  ├─ calendario/ aprovacoes/ logistica/ conferencia/
│  │  └─ cadastros/ avarias/ painel/ direcao/
│  ├─ api/                  a ÚNICA porta para o banco (route handlers + validação)
│  └─ components/           Modal, Avisos, Campos, Tabela, Assinatura, Icone…
├─ lib/
│  ├─ tipos.ts              o domínio inteiro, derivado do schema SQL
│  ├─ papeis.ts             quem pode o quê (puro — o middleware importa)
│  ├─ token.ts / sessao.ts  o cookie de sessão e a revalidação no banco
│  ├─ supabaseServidor.ts   o cliente que age COMO o usuário logado
│  ├─ dados.ts              o que era carregarDB(), agora no servidor
│  ├─ consultas.ts          as perguntas que as telas fazem sobre os dados
│  ├─ validacao.ts          leitores de corpo de requisição
│  ├─ erros.ts              erro do Postgres → frase de gente
│  ├─ clockify.ts           a integração, agora do lado do servidor
│  ├─ formato.ts listas.ts navegacao.ts limiteTentativas.ts ambiente.ts
├─ middleware.ts            a primeira barreira (Edge, sem banco)
├─ next.config.js           CSP, HSTS e os demais cabeçalhos de segurança
├─ public/                  fontes e imagens
├─ doc/                     o formulário original em .xlsx
├─ supabase/                01 + 02 + 03 + 04 — a fonte da verdade
└─ legado/                  a versão estática anterior, guardada para consulta
```

O CSS não foi reescrito: `app/globals.css` é o `style.css` do Controle de Estoque com uma única
mudança — os caminhos das fontes, de `fonts/` para `/fonts/`, porque o bundler serve o CSS de
outro diretório. **Alterações de design que valem para os dois sistemas continuam sendo feitas
no `style.css` do estoque e copiadas para cá**; os blocos no fim do arquivo (`SOLICITAÇÃO DE
CAMPO` e `v2`) são os únicos trechos exclusivos do campo.

Há um terceiro trecho exclusivo, e ele é o que mais corre risco numa cópia dessas: o bloco
**`MENU LONGO: A BARRA VAI PARA A ESQUERDA`** (`.layout-lateral`, dentro de um
`@media(min-width:769px)`). Ele não existe no estoque porque lá nenhum papel chega a nove abas —
aqui a Direção tem dez, e a barra horizontal só foi desenhada para oito. **Não apague ao
sincronizar o CSS.**

Como funciona: com **mais de oito abas**, `(sistema)/layout.tsx` põe a classe `layout-lateral`
no `#appScreen` e a barra vira uma coluna fixa de `--sidebar-width` à esquerda, com o conteúdo
deslocado para o lado. A decisão é por **contagem de abas**, e não por largura de tela — é por
isso que ela não mora num `@media`: dez botões estouram a barra do topo até num monitor de 1920,
porque `.sidebar-btn` não encolhe. Na vertical o espaço é a altura da tela, então as dez abas
cabem com o rótulo inteiro em vez de virarem ícone sem nome. No celular nada disso vale: abaixo
de 769px a barra desce para o rodapé, para todos os papéis, como já era.

`legado/` guarda o site estático inteiro (`index.html`, `script.js`, `config.js`, `env.js`,
`vendor/`, `vercel.json`) para consulta durante a transição. Nada em `app/` ou `lib/` o
importa; quando não fizer mais falta, pode ser apagado.
