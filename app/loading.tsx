// Estado de carregamento enquanto o Server Component busca os dados.
// Sem ele, a navegação entre abas fica parada na tela anterior até a
// consulta voltar, e parece que o clique não funcionou.

export default function Carregando() {
  return (
    <div className="empty-state" style={{ padding: "3rem 1rem" }}>
      <strong>Carregando…</strong>
    </div>
  );
}
