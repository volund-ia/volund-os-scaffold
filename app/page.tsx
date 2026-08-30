import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { MonoLabel } from "@/components/ui/mono-label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  APP_HOME_PATH,
  AUTH_LOGIN_PATH,
  SESSION_COOKIE,
  readAuthConfig,
} from "@/lib/auth/config";
import { readSealedPayload } from "@/lib/auth/session";

/**
 * Vitrine — a **única** página pública deste App, e só para quem ainda não entrou.
 *
 * O agente substitui este arquivo pelo que a aplicação deve mostrar a quem ainda
 * não entrou. Todo o resto nasce protegido: a lista de rotas públicas é
 * enumerada em `lib/auth/route-policy.ts`, e acrescentar uma entrada lá é uma
 * decisão de segurança, não de layout.
 *
 * ## Por que ela existe
 *
 * O endereço publicado precisa abrir para qualquer visitante. Sem uma página
 * pública, o endereço de um App fechado seria uma tela morta para quem só quer
 * saber o que é aquilo.
 *
 * ## Por que ela NÃO pode ser o destino de quem já entrou
 *
 * Dentro do painel do VolundOS o App é aberto pela RAIZ. Enquanto esta página
 * era estática e nunca lia cookie, ela mostrava "Entrar" para todo mundo — e uma
 * sessão válida de trinta dias parecia expirada toda vez que alguém abria a
 * aplicação. O relato era literal: "o login precisa ser refeito toda vez".
 *
 * A versão anterior deste comentário dizia que o login "não se completa dentro
 * daquele quadro" e por isso a vitrine sempre oferecia a aba separada. Era
 * verdade quando o quadro tinha origem opaca e não carregava cookie nenhum;
 * deixou de ser em 03/08/2026, quando o cookie de sessão deste scaffold passou a
 * ser particionado (CHIPS) e a existir dentro do quadro, e em 25/08/2026, quando
 * o quadro do painel ganhou `allow-same-origin`. Com sessão, aqui, o certo é
 * ENTRAR — e é o que ela faz agora.
 *
 * Ela deixou de ser estática por isso: ler cookie é por requisição. O que não
 * mudou é o que a manteve estática — nada aqui toca o banco, então o `next
 * build` continua rodando sem `DATABASE_URL`, e o Postgres pode ser
 * provisionado depois do primeiro build.
 *
 * ## Ela também é o exemplo do DESIGN.md
 *
 * Repare no que ela NÃO tem: nenhuma cor escrita à mão. O fundo escuro e o
 * crimson vêm dos tokens (`app/globals.css`), então trocar o tema não pede
 * reescrever tela. E há UMA ação principal — "Entrar", com o `Button` padrão, que
 * é crimson; "Checar conexão" é `outline`, porque é a ação secundária. Duas ações
 * crimson na mesma tela fariam a pessoa clicar na errada.
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  // A pergunta aqui é só "existe sessão?", e ela se responde com o SELO do
  // cookie — sem rede. `readSession` validaria o token contra o JWKS do
  // provedor, e uma ida à rede na raiz pública atrasaria a página de quem nem
  // sessão tem. Quem confere de verdade é o `proxy.ts`, no destino: um cookie
  // selado mas com token vencido cai no login lá, que é o lugar certo.
  //
  // `readAuthConfig` pode lançar quando o ambiente ainda não foi injetado (App
  // recém-criado, antes do primeiro deploy). Aí a vitrine aparece — que é a
  // resposta honesta: sem configuração não há sessão para reconhecer.
  let temSessao = false;
  try {
    const config = readAuthConfig();
    const selado = (await cookies()).get(SESSION_COOKIE)?.value;
    temSessao = (await readSealedPayload(selado, config)) !== null;
  } catch {
    temSessao = false;
  }

  if (temSessao) redirect(APP_HOME_PATH);

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <MonoLabel>Aplicação</MonoLabel>
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
          {/* O destino sai da constante, e não de um caminho digitado aqui:
              mudar a home num lugar e esquecer o outro daria um 404 logo depois
              do login — o pior lugar possível para um endereço errado. */}
          <a
            className={buttonVariants()}
            href={`${AUTH_LOGIN_PATH}?returnTo=${encodeURIComponent(APP_HOME_PATH)}`}
          >
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
