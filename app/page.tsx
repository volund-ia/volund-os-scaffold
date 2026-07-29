import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Placeholder da home. O agente SUBSTITUI este arquivo pelo produto real — ele
 * existe para o scaffold já buildar e deployar de pé, e para mostrar de onde vêm
 * os componentes de interface.
 *
 * Mantido ESTÁTICO de propósito: nada aqui toca o banco, então `next build` roda
 * sem `DATABASE_URL` (o provisionamento do Postgres pode acontecer depois do
 * primeiro build). A checagem de banco vive em `/api/health`, que é dinâmica.
 */
export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Aplicação no ar</CardTitle>
          <CardDescription>
            Scaffold Next.js + Postgres com shadcn/ui pronto. Substitua esta página pelo
            produto.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {/* Base UI usa `render` para trocar o elemento renderizado — o
              `asChild` do Radix não existe nesta versão do shadcn. */}
          <Button render={<a href="/api/health" />}>Checar conexão com o banco</Button>
          <Button variant="outline" render={<a href="/api/echo" />}>
            Ver a rota de exemplo
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
