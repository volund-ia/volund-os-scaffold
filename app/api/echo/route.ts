import { serviceRoute } from "@/lib/http/service-route";
import { ecoar } from "@/lib/services/eco";

/**
 * Rota de API de EXEMPLO — o padrão que toda rota nova deve seguir.
 *
 * Existe porque o exemplo é o que acaba copiado, e é por isso que ela não tem
 * corpo: **a rota não decide nada.** O schema da entrada, a permissão exigida e
 * o que fazer com os dados estão no serviço (`lib/services/eco.ts`), que é o
 * mesmo que a tela e a tool de MCP chamam. O que a rota faz é traduzir — pedido
 * em entrada, resultado em resposta —, e essa tradução mora em
 * `lib/http/service-route.ts`, uma vez, para todas.
 *
 * Antes esta rota lia o corpo, validava com um schema próprio e montava a
 * resposta aqui dentro. Era a única porta do scaffold com regra própria, e
 * duplicá-la para a tool de MCP era o começo da divergência: dois lugares
 * respondendo a mesma pergunta, com uma mudança sendo aplicada só num deles.
 *
 * Precisa de algo que o adaptador não cobre — parâmetro de caminho, cabeçalho,
 * upload? Escreva o handler à mão e devolva `serviceResponse(resultado)`.
 *
 * Substitua ou apague quando a aplicação tiver rotas de verdade.
 */
export const dynamic = "force-dynamic";

export const POST = serviceRoute(ecoar, { from: "json" });
