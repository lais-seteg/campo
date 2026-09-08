"use client";

// Tela de erro do App Router. O `error.tsx` precisa ser Client Component
// por contrato do Next — é ele que recebe o botão de tentar de novo.
//
// A mensagem do erro NÃO é mostrada: em produção o Next já a substitui por
// um texto genérico do lado do cliente, e exibir o que sobra só serviria
// para vazar detalhe de servidor sem ajudar quem está lendo. O `digest` é
// o que liga esta tela à linha correspondente no log.

import { useEffect } from "react";

export default function TelaDeErro({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[erro-de-renderizacao]", error);
  }, [error]);

  return (
    <div className="empty-state" style={{ padding: "3rem 1rem" }}>
      <strong>Não foi possível carregar esta tela.</strong>
      <p>
        Tente de novo. Se continuar, avise a Gestão informando o horário
        {error.digest ? ` e o código ${error.digest}` : ""}.
      </p>
      <button className="btn btn-primary btn-sm" type="button" onClick={reset} style={{ marginTop: "1rem" }}>
        Tentar de novo
      </button>
    </div>
  );
}
