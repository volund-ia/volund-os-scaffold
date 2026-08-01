import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireSession } from "@/lib/auth/server";

/**
 * Exemplo de página protegida — o modelo que o agente copia.
 *
 * Duas coisas para reparar:
 *
 * 1. Não há nenhuma configuração dizendo "esta rota é privada". Ela é privada
 *    porque **todas** são, por herança do `proxy.ts`.
 * 2. Mesmo assim a página chama `requireSession()`. Não é redundância: o proxy
 *    protege rotas, e uma mudança de `matcher` ou um arquivo movido tiram essa
 *    cobertura sem nenhum sinal. Quem depende da identidade a pede de novo, ali
 *    onde ela é usada.
 *
 * `force-dynamic` porque ler cookie é por requisição — pré-renderizar isto no
 * build serviria a sessão de ninguém para todo mundo.
 */
export const dynamic = "force-dynamic";

export default async function Painel() {
  const session = await requireSession("/painel");

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Você está autenticado</CardTitle>
          <CardDescription>
            A identidade vem da sua organização no VolundOS. Este App não guarda senha
            nem cadastro próprio.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Nome</dt>
            <dd>{session.name ?? "—"}</dd>
            <dt className="text-muted-foreground">E-mail</dt>
            <dd>{session.email ?? "—"}</dd>
            <dt className="text-muted-foreground">Permissões</dt>
            <dd>
              {session.permissions.length > 0
                ? session.permissions.join(", ")
                : "nenhuma concedida ainda"}
            </dd>
          </dl>

          {/* Formulário e não link: sair é POST, para que uma imagem apontando
              para cá não derrube a sessão de quem abrir uma página de terceiro. */}
          <form action="/api/auth/logout" method="post">
            <Button type="submit" variant="outline" className="w-full">
              Sair
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
