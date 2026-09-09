// ═══════════════════════════════════════════════════════════════════════
//  O LAYOUT DE DENTRO DO SISTEMA
//
//  Tudo que está sob `(sistema)` exige sessão. O parêntese no nome é um
//  grupo de rotas do App Router: ele NÃO entra na URL (a pasta
//  `(sistema)/painel` responde em `/painel`), só serve para dar um layout
//  comum a um conjunto de telas. O login fica de fora dele justamente por
//  isso — não tem barra lateral e não exige sessão.
//
//  `exigirSessao()` aqui é a checagem AUTORITATIVA que o middleware não
//  pode fazer: ele confere a assinatura do cookie em Edge, sem banco;
//  aqui `perfis.ativo` é relido. Um acesso desativado é barrado na
//  primeira navegação, não daqui a sete dias.
// ═══════════════════════════════════════════════════════════════════════

import { exigirSessao, tokenDaSessao } from "@/lib/sessao";
import { carregarDados } from "@/lib/dados";
import { BarraLateral } from "@/app/components/BarraLateral";
import { AvisoDeEstrutura } from "@/app/components/AvisoDeEstrutura";
import { DicasDaTabela } from "@/app/components/DicasDaTabela";
import { abasDoPapel } from "@/lib/navegacao";
import { contadoresDoMenu } from "@/lib/consultas";
import { cargoDoPerfil, ehLider, podeAbrirPainel } from "@/lib/papeis";

export const dynamic = "force-dynamic";

export default async function LayoutDoSistema({ children }: { children: React.ReactNode }) {
  // ── AS DUAS LEITURAS COMEÇAM JUNTAS ──
  //
  // Antes era `await exigirSessao()` e só então `await carregarDados()`:
  // duas idas ao banco EMPILHADAS em cada navegação, e a segunda esperando
  // a primeira sem precisar. Não precisava porque o access token não vem de
  // `perfis` — vem assinado dentro do cookie, e `tokenDaSessao()` o entrega
  // sem tocar no banco.
  //
  // Então `carregarDados` sai na frente e a revalidação do perfil corre ao
  // lado dela. A segurança não muda: `exigirSessao()` continua conferindo
  // `perfis.ativo` a cada requisição e redirecionando quem não passa, e o
  // que `carregarDados` conseguir ler já é filtrado pela RLS — um acesso
  // desativado não recebe linha nenhuma de todo modo.
  const token = await tokenDaSessao();
  const dadosEmVoo = token ? carregarDados(token) : null;

  const usuario = await exigirSessao();

  // `carregarDados` é memoizada por requisição (React `cache`) e a chave é o
  // token — o mesmo dos dois lados. Então isto não é uma segunda leitura:
  // é a que já estava em voo, e a página de dentro reaproveita a mesma.
  const dados = dadosEmVoo ? await dadosEmVoo : await carregarDados(usuario.accessToken);

  const abas = abasDoPapel(
    usuario.papel,
    ehLider(usuario.id, usuario.papel, dados.projetos),
    // O Painel é a tela do valor consolidado: quem não vê valor abriria
    // seis números vazios. A aba sumir não é a barreira — a página
    // reconfere e a RLS não entrega a linha de gasto do projeto.
    podeAbrirPainel(usuario, dados.projetos)
  );
  const contadores = contadoresDoMenu(
    dados.solicitacoes,
    dados.avarias,
    usuario.id,
    usuario.papel,
    dados.projetos
  );

  // ── QUANDO A BARRA DEIXA DE SER DE CIMA E VIRA DE LADO ──
  //
  // A barra do topo foi desenhada para até oito abas: com dez (o menu da
  // Direção), os botões não cabem entre a logo e o rodapé, e como eles não
  // encolhem (`flex-shrink:0`) o excesso passa POR CIMA dos vizinhos em vez
  // de ser cortado. Os degraus responsivos não resolvem, porque reagem à
  // largura da tela e o estouro aqui vem da QUANTIDADE de abas — acontece
  // igual num monitor de 1920.
  //
  // Acima de oito, o menu desce pela esquerda: na vertical o espaço é a
  // altura da tela, que sobra, e cada aba mantém o rótulo em vez de virar
  // um ícone mudo. No celular nada disso vale — lá a barra já vai para o
  // rodapé, para todo mundo (ver o @media de 768px em globals.css).
  const menuLateral = abas.length > 8;

  return (
    <div id="appScreen" className={menuLateral ? "layout-lateral" : undefined}>
      <BarraLateral
        nome={usuario.nome}
        cargo={cargoDoPerfil(usuario.usuario, usuario.cargo)}
        abas={abas}
        contadores={contadores}
      />
      <main className="app-main">
        <AvisoDeEstrutura estrutura={dados.estrutura} />
        {children}
      </main>
      {/* ── A DICA DO QUE NÃO COUBE ──
          Toda célula de tabela ocupa uma linha só, e o que passa da largura
          é cortado com "…". Este componente devolve o texto inteiro no
          `title` — mas SÓ nas células que realmente cortaram, medindo depois
          de a tabela estar desenhada.

          Mora no layout, e não em cada tabela, porque assim alcança também
          as que ficam dentro de MODAIS (o painel de logística, a folha de
          conferência, o previsto × real do olho) — justamente as que
          ninguém lembraria de embrulhar uma a uma.

          Não desenha nada: se falhar, a célula continua cortada pelo CSS e
          o que se perde é a dica. */}
      <DicasDaTabela />
    </div>
  );
}
