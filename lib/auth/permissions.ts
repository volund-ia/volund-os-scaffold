/**
 * Checagem de permissão — negação por default.
 *
 * ## Leia isto antes de proteger uma tela com `can()`
 *
 * O catálogo de permissões por App **existe** e está no ar. São dois passos, e
 * eles são de donos diferentes:
 *
 * 1. **Você declara** quais permissões e papéis a aplicação tem, chamando a
 *    ferramenta `report_app_permissions`. É declarativo: mande o catálogo
 *    inteiro, com chaves sem namespace (`fechar_mes`, e não `app:algo:fechar_mes`
 *    — o servidor põe o dele). Declarar **não concede nada a ninguém**, nem a
 *    você, nem a quem criou o App;
 * 2. **Uma pessoa concede**, na aba Segurança do App, no VolundOS. A partir daí
 *    as permissões chegam em `session.permissions` e os papéis em `session.roles`,
 *    e `can()` responde `true` para quem recebeu.
 *
 * Entre um passo e outro, `can()` devolve `false` para todo mundo — e isso é
 * projeto, não pendência: um papel implícito ("é membro da organização, logo é
 * administrador do App") faria a baseline da organização vazar para dentro do
 * App. Nenhuma concessão nasce sozinha.
 *
 * O que fazer com isso: **declare o catálogo, proteja com `can()`, e avise a
 * pessoa que ela precisa conceder** na aba Segurança. Uma tela que nega todo
 * mundo até a primeira concessão é o estado correto e temporário; ele se resolve
 * com um clique de quem administra, sem tocar no código.
 *
 * ## O que NÃO fazer (aconteceu duas vezes)
 *
 * > Não construa uma lista de administradores dentro do banco da aplicação —
 * > nem por e-mail, nem por id de usuário, nem por "tabela de papéis" própria.
 *
 * Foi o que dois agentes fizeram, em Apps diferentes, ao ler uma versão anterior
 * deste comentário que dizia que o catálogo não existia. O resultado, nos dois
 * casos: uma lista paralela sem trilha de auditoria, sem revogação, invisível
 * para quem administra a organização — e que precisa de você toda vez que muda.
 * Num deles a lista era conferida contra um campo da sessão que vinha vazio, e o
 * App inteiro ficou trancado: nem quem o criou conseguia executar a ação
 * restrita.
 *
 * A pergunta que separa os dois caminhos é simples: **quem muda quem pode o
 * quê?** Se a resposta for "eu, editando código", é o caminho errado.
 *
 * ## O portão de baixo continua sendo a sessão
 *
 * Estar autenticado, com token desta audiência, na organização dona do App —
 * é o que `guard()` verifica, e é o que protege TODAS as rotas por herança,
 * independentemente de permissão. `can()` é o segundo nível: distingue quem
 * entrou de quem pode uma ação específica.
 */

import type { Session } from "./session";

/**
 * O usuário tem a permissão?
 *
 * Negação por default: permissão que não está declarada na sessão é permissão
 * que não foi concedida. A ausência nunca é interpretada como liberação.
 */
export function can(session: Session | null, permission: string): boolean {
  if (!session || !permission) return false;
  return session.permissions.includes(permission);
}

/** O usuário tem o papel? Mesma regra: ausência é negação. */
export function hasRole(session: Session | null, role: string): boolean {
  if (!session || !role) return false;
  return session.roles.includes(role);
}

/**
 * Esconder um elemento de interface **não é** proteção.
 *
 * Existe para deixar o par explícito no código: onde houver `hideUnless`, tem de
 * haver a mesma checagem no servidor, no limite que a ação atravessa. Quem chama
 * a API direto, sem passar pela tela, nunca viu o elemento escondido.
 *
 * ## E o inverso também confunde: não MOSTRE o que o servidor nega
 *
 * A frase acima é sobre esconder de menos. Falta a outra metade, e ela apareceu
 * num App real em 02/08/2026: a tela mostrava o botão "Liberar" para quem não
 * tinha a permissão, e o servidor recusava com "sem permissão" ao clique. A
 * proteção estava certa — a interface é que prometia uma ação que não existia
 * para aquela pessoa.
 *
 * As duas metades têm a mesma regra: **a presença do controle e a decisão do
 * servidor saem do MESMO `can()`**. Um botão cuja condição de aparecer é
 * diferente da condição de executar vai divergir, e a pessoa descobre no clique.
 *
 * ```tsx
 * // A tela pergunta a mesma coisa que a rota vai perguntar.
 * {can(session, "fechar_mes") && <button formAction={fecharMes}>Fechar o mês</button>}
 * ```
 *
 * ```ts
 * // ...e a rota pergunta de novo, porque quem chama a API não passou pela tela.
 * if (!can(gate.session, "fechar_mes")) {
 *   return NextResponse.json({ error: "sem permissão" }, { status: 403 });
 * }
 * ```
 */
export function hideUnless(session: Session | null, permission: string): boolean {
  return !can(session, permission);
}
