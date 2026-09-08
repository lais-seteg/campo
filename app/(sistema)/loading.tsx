// ═══════════════════════════════════════════════════════════════════════
//  O QUE APARECE ENQUANTO A PRÓXIMA ABA CARREGA
//
//  ── POR QUE ESTE ARQUIVO EXISTE, TENDO UM `loading.tsx` NA RAIZ ──
//
//  A fronteira de carregamento vale para o SEGMENTO em que está. A da raiz
//  envolve o layout do sistema INTEIRO — barra lateral incluída. Com só
//  ela, clicar em Calendário trocava a tela completa por "Carregando…": o
//  menu piscava e sumia, e a navegação parecia recarregar o site.
//
//  Esta fica DENTRO do layout do sistema, então a barra lateral permanece
//  na tela e só a área de conteúdo mostra o esqueleto. É o que faz o clique
//  responder na hora, mesmo que o servidor ainda esteja buscando.
//
//  Todas as telas são `force-dynamic` (o dado é da operação de agora, não
//  cabe cache), então SEMPRE existe uma espera aqui. A pergunta não é se
//  ela aparece, é se ela aparece com o menu no lugar.
// ═══════════════════════════════════════════════════════════════════════

export default function CarregandoTela() {
  return (
    <section className="secao active" aria-busy="true" aria-live="polite">
      <div className="sec-header">
        <div className="sk sk-titulo" />
      </div>

      {/* O esqueleto imita a FORMA das telas do sistema — faixa de
          indicadores em cima, tabela embaixo. Bloco cinza no formato certo
          faz a tela parecer que já chegou; um "Carregando…" centralizado
          faz parecer que travou. */}
      <div className="kpi-row">
        {[0, 1, 2, 3].map((i) => (
          <div className="sk sk-kpi" key={i} />
        ))}
      </div>

      <div className="lista-wrapper">
        <div className="table-controls">
          <div className="sk sk-linha-filtro" />
        </div>
        <div className="table-wrapper" style={{ padding: "0 1rem 1rem" }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div className="sk sk-linha" key={i} />
          ))}
        </div>
      </div>

      {/* Para leitor de tela: o esqueleto é decoração, esta frase é a
          informação. */}
      <span className="sr-only">Carregando a tela…</span>
    </section>
  );
}
