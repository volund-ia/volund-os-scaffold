import { buttonVariants } from "@/components/ui/button";
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
          {/* Âncora com a APARÊNCIA de botão, e não `Button` renderizado como
              âncora: o componente leva junto atributos de botão (`type`,
              `tabindex`) que não existem em `<a>`. Para AÇÃO — enviar, salvar —
              use `Button`; e, se precisar trocar o elemento dele, é pela prop
              `render` do Base UI (o `asChild` do Radix não existe nesta versão
              do shadcn), como faz o botão de sair em `app/painel/page.tsx`. */}
          <a className={buttonVariants()} href="/api/auth/login?returnTo=%2Fpainel">
            Entrar
          </a>
          <a className={buttonVariants({ variant: "outline" })} href="/api/health">
            Checar conexão com o banco
          </a>
        </CardContent>
      </Card>
    </main>
  );
}
