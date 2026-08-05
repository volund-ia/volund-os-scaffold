import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { requireSession } from "@/lib/auth/server";
import { verDiagnostico, verPerfil } from "@/lib/services/painel";

/**
 * Exemplo de página protegida — o modelo que o agente copia.
 *
 * Três coisas para reparar:
 *
 * 1. Não há nenhuma configuração dizendo "esta rota é privada". Ela é privada
 *    porque **todas** são, por herança do `proxy.ts`.
 * 2. Mesmo assim a página chama `requireSession()`. Não é redundância: o proxy
 *    protege rotas, e uma mudança de `matcher` ou um arquivo movido tiram essa
 *    cobertura sem nenhum sinal. Quem depende da identidade a pede de novo, ali
 *    onde ela é usada.
 * 3. A página **não decide nada**: ela pergunta aos serviços de `lib/services/` e
 *    mostra o que eles responderam. É o que mantém a tela dizendo a mesma coisa
 *    que a rota de API diz — a decisão tem um lugar só.
 *
 * Sobre o item 3, o detalhe que evita a divergência clássica: a seção restrita
 * abaixo aparece **porque o serviço respondeu**, e não porque a tela conferiu a
 * permissão por conta própria. Um controle cuja condição de aparecer é escrita
 * separadamente da condição de executar vai divergir, e a pessoa descobre no
 * clique.
 *
 * Em Server Component o serviço é chamado direto, no mesmo processo. Componente
 * de cliente não faz isso: ele chama a rota de API, que chama o mesmo serviço.
 *
 * `force-dynamic` porque ler cookie é por requisição — pré-renderizar isto no
 * build serviria a sessão de ninguém para todo mundo.
 */
export const dynamic = "force-dynamic";

export default async function Painel() {
  const session = await requireSession("/painel");

  const perfil = await verPerfil.execute(session, {});
  const diagnostico = await verDiagnostico.execute(session, {});

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
          {perfil.ok ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Nome</dt>
              <dd>{perfil.data.nome ?? "—"}</dd>
              <dt className="text-muted-foreground">E-mail</dt>
              <dd>{perfil.data.email ?? "—"}</dd>
              <dt className="text-muted-foreground">Permissões</dt>
              <dd>
                {perfil.data.permissoes.length > 0
                  ? perfil.data.permissoes.join(", ")
                  : "nenhuma concedida ainda"}
              </dd>
            </dl>
          ) : (
            <p className="text-muted-foreground text-sm">{perfil.error.message}</p>
          )}

          <Separator />

          {diagnostico.ok ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">App</dt>
              <dd className="font-mono text-xs break-all">{diagnostico.data.appId}</dd>
              <dt className="text-muted-foreground">Organização</dt>
              <dd className="font-mono text-xs break-all">{diagnostico.data.orgId}</dd>
              <dt className="text-muted-foreground">Banco</dt>
              <dd>{diagnostico.data.bancoConfigurado ? "configurado" : "ausente"}</dd>
            </dl>
          ) : (
            /* O texto diz o que fazer, e não só que faltou permissão: sem isso,
               "sem permissão" no primeiro acesso parece defeito da aplicação. */
            <p className="text-muted-foreground text-sm">
              Os detalhes técnicos ficam restritos a quem tem a permissão{" "}
              <code>{diagnostico.error.permission ?? "—"}</code>. Ela é declarada pela
              própria aplicação e concedida por uma pessoa, na aba Segurança do App, no
              VolundOS.
            </p>
          )}

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
