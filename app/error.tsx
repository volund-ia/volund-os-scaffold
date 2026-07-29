"use client";

/**
 * Erro não tratado em qualquer página. Sem este arquivo o Next mostra a tela
 * genérica dele, que não diz nada ao usuário e nem oferece saída.
 *
 * A mensagem do erro NÃO vai para a tela: em produção ela costuma carregar
 * detalhe de infraestrutura (host, driver, consulta). Vai para o console, que o
 * provedor de deploy coleta junto do deploy.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("[app] erro não tratado:", error);
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">Algo deu errado</h1>
      <p className="max-w-md text-sm opacity-70">
        A página não pôde ser carregada. Tente de novo; se continuar, o erro está
        registrado nos logs da aplicação.
      </p>
      {error.digest && (
        <code className="rounded bg-current/10 px-2 py-1 text-xs opacity-60">
          {error.digest}
        </code>
      )}
      <button
        type="button"
        onClick={reset}
        className="rounded-md border border-current/20 px-4 py-2 text-sm hover:bg-current/5"
      >
        Tentar de novo
      </button>
    </main>
  );
}
