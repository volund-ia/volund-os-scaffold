/**
 * Estado de carregamento das transições de rota. Sem ele a navegação para uma
 * página que busca dados fica sem feedback nenhum — a tela simplesmente
 * congela na anterior.
 */
export default function Loading() {
  return (
    <main className="flex flex-1 items-center justify-center p-8" aria-busy="true">
      <span className="text-sm opacity-60">Carregando…</span>
    </main>
  );
}
