import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Vitrine — a **única** página pública deste App.
 *
 * O agente substitui este arquivo pelo que a aplicação deve mostrar a quem ainda
 * não entrou. Todo o resto nasce protegido: a lista de rotas públicas é
 * enumerada em `lib/auth/route-policy.ts`, e acrescentar uma entrada lá é uma
 * decisão de segurança, não de layout.
 *
 * ## Por que ela existe
 *
 * O endereço publicado precisa abrir para qualquer visitante — inclusive dentro
 * da prévia do VolundOS, que é um quadro isolado e não carrega cookies. Sem uma
 * página pública, a prévia de um App fechado seria uma tela morta. O login não
 * se completa dentro daquele quadro: acontece em aba de primeira classe, pelo
 * botão abaixo.
 *
 * Mantida ESTÁTICA de propósito: nada aqui toca o banco nem lê cookie, então o
 * `next build` roda sem `DATABASE_URL` — o Postgres pode ser provisionado depois
 * do primeiro build. A checagem de banco vive em `/api/health`, que é dinâmica.
 */
export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Aplicação no ar</CardTitle>
          <CardDescription>
            Esta é a página pública. O sistema fica atrás da autenticação da sua
            organização — entre para continuar.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {/* Base UI usa `render` para trocar o elemento renderizado — o
              `asChild` do Radix não existe nesta versão do shadcn. */}
          <Button render={<a href="/api/auth/login?returnTo=%2Fpainel" />}>
            Entrar
          </Button>
          <Button variant="outline" render={<a href="/api/health" />}>
            Checar conexão com o banco
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
