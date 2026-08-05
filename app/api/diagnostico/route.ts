import { serviceRoute } from "@/lib/http/service-route";
import { verDiagnostico } from "@/lib/services/painel";

/**
 * O par protegido do `echo`: a mesma rota de quatro linhas, sobre um serviço que
 * exige permissão.
 *
 * Repare que **não há checagem de permissão aqui**. Quem responde "esta pessoa
 * pode?" é o serviço, e é a mesma resposta que o painel usa para decidir se
 * mostra a seção de diagnóstico — a tela e a rota não podem discordar porque só
 * existe uma decisão. Enquanto ninguém conceder `ver_diagnostico` na aba
 * Segurança do App, esta rota responde 403 para todo mundo, e isso é o projeto
 * funcionando.
 *
 * `force-dynamic` porque a resposta depende de quem pediu: pré-renderizar isto
 * no build serviria a sessão de ninguém para todo mundo.
 */
export const dynamic = "force-dynamic";

export const GET = serviceRoute(verDiagnostico, { from: "query" });
