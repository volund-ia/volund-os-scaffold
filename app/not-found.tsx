import Link from "next/link";

/** Endereço que não existe. */
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">Página não encontrada</h1>
      <p className="max-w-md text-sm opacity-70">
        O endereço acessado não existe nesta aplicação.
      </p>
      <Link
        href="/"
        className="rounded-md border border-current/20 px-4 py-2 text-sm hover:bg-current/5"
      >
        Voltar ao início
      </Link>
    </main>
  );
}
