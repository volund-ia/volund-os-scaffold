/**
 * Quais serviços **não exigem permissão** — a regra pura, enumerada, para poder
 * ser exercitada em teste.
 *
 * ## "Público" aqui é sobre permissão, não sobre sessão
 *
 * Não existe serviço anônimo. A sessão é o portão de baixo e vale para todos:
 * `execute()` recusa quem chega sem sessão, do mesmo jeito que o `proxy.ts`
 * recusa a requisição sem cookie e que o MCP recusa a chamada sem token. O que
 * se dispensa nesta lista é o **segundo** portão — a permissão do catálogo do
 * App. Conteúdo que precise aparecer para quem nunca entrou fica na vitrine, que
 * não passa por serviço.
 *
 * (Não confunda com `lib/auth/route-policy.ts`: lá a lista diz quais *rotas*
 * abrem sem sessão. São dois eixos diferentes, com listas separadas de
 * propósito — uma entrada no lugar errado abriria mais do que quem a escreveu
 * pretendia.)
 *
 * ## Por que uma lista, e não a ausência de permissão no serviço
 *
 * Porque as duas situações são indistinguíveis em tempo de execução: um serviço
 * público por decisão e um serviço que ficou sem permissão por esquecimento se
 * comportam igual. Só a declaração as separa. Então `permission: null` sozinho
 * não basta — o nome tem de estar aqui, e `defineService` recusa a definição que
 * não estiver, na importação do módulo.
 *
 * Acrescentar um nome aqui é uma decisão de segurança. Ela vem com o motivo
 * escrito ao lado.
 */

export const PUBLIC_SERVICES: readonly string[] = [
  // O painel de exemplo mostra à pessoa os dados da própria sessão. Não há o que
  // restringir: quem tem sessão já é o dono do que este serviço devolve.
  "ver_perfil",
];

/** O serviço está declarado como "não exige permissão"? */
export function isPublicService(name: string): boolean {
  return PUBLIC_SERVICES.includes(name);
}
