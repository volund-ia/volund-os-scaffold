/**
 * Placeholder da home. O agente SUBSTITUI este arquivo pelo produto real —
 * ele só existe para o scaffold já buildar e deployar de pé.
 *
 * Mantido ESTÁTICO de propósito: nada aqui toca o banco, então `next build`
 * roda sem `DATABASE_URL` (o provisionamento do Postgres pode acontecer depois
 * do primeiro build). A checagem de banco vive em `/api/health`, que é
 * dinâmica.
 */
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">Aplicação no ar</h1>
      <p className="max-w-md text-sm opacity-70">
        Scaffold Next.js + Postgres pronto. Substitua esta página pelo produto.
      </p>
      <a
        className="rounded-md border border-current/20 px-4 py-2 text-sm hover:bg-current/5"
        href="/api/health"
      >
        Checar conexão com o banco
      </a>
    </main>
  );
}
