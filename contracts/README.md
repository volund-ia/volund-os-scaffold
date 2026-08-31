# Contratos entre a plataforma e o scaffold dos Apps

## Por que este diretório existe

Todo defeito da esteira de autenticação dos Apps teve o mesmo formato: **duas
pontas de um contrato, cada uma certa sozinha, e ninguém olhando as duas
juntas.**

O caso mais caro foi `session.email`. O scaffold lia `claims.email` do access
token; o provedor nunca emitia esse claim. Os dois lados estavam internamente
coerentes, os dois tinham teste, e nenhum teste falhava. O campo chegava `null`
para todo mundo, em todo App — por dois marcos inteiros. Só apareceu quando um
agente construiu a regra de acesso de um App em cima dele e o App inteiro ficou
trancado, o que exigiu um teste manual em produção para descobrir.

Um arquivo de contrato não impede a divergência. O que ele faz é **dar às duas
pontas a mesma frase para conferir**, de modo que a divergência falhe um teste
em vez de aparecer meses depois na tela de alguém.

## `auth-claims.json`

Descreve os claims do **access token** — o token que o App relê a cada
requisição, e do qual sai tudo o que a aplicação sabe sobre quem está do outro
lado.

| Campo                | O que significa                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract`           | O contrato de scaffold a que este arquivo pertence. É o mesmo número de `volund-scaffold.json`, e é ele que a plataforma recusa quando não suporta. |
| `accessToken.always` | Claims presentes em **todo** access token, independentemente do escopo.                                                                             |
| `accessToken.scoped` | Claim → escopo que o libera. Sem o escopo, o claim **não sai** — é o que impede o token de virar "o perfil de quem o pediu".                        |
| `session`            | Campo da sessão que o App enxerga → claim que o alimenta. É esta linha que estava quebrada no caso do `email`.                                      |

## `agent-channel.json`

Descreve o **canal de agentes** (contrato 8): como esta aplicação atravessa a
fronteira de audiência para falar com a plataforma **em nome de quem está usando
ela**, e o que recebe de volta.

| Campo      | O que significa                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exchange` | Os valores do pedido de troca (RFC 8693): `grant_type`, os tipos de token, o caminho do `resource` e o escopo. Errar um deles vira recusa, não comportamento diferente. |
| `roster`   | O endereço e os campos do roteiro de agentes, lido em tempo de execução.                                                                                                |
| `proxy`    | As rotas deste scaffold que a tela usa — e o `channel_error`, o único quadro que o proxy emite por conta própria.                                                       |

Duas coisas que ele fixa e que vale ler antes de mexer:

- **`serverOnlyFields`.** O roteiro traz o identificador do agente, e ele **não**
  atravessa o navegador. Se atravessasse, uma tela poderia endereçar qualquer
  agente da organização — e a oferta do App deixaria de ser oferta.
- **`channel_error` fica de fora da união de eventos do agente.** Traduzir uma
  queda de conexão para `run_finished status:"failed"` diria que o agente falhou,
  e ele pode ter terminado bem do outro lado.

## Como as duas pontas usam

- **`volund-os`** (`tests/unit/oidc-contrato-de-claims.test.ts`): confere que
  `accessTokenClaims` emite exatamente isto — os `always` sempre, os `scoped`
  só com o escopo correspondente.
- **`volund-os-scaffold`** (`tests/auth-contrato-de-claims.test.ts`): confere
  que a sessão montada a partir desses claims chega com todos os campos
  preenchidos — nenhum `null` onde o contrato promete valor.
- **`agent-channel.json`** é conferido por
  `tests/volund-canal-do-agente.test.ts`: o pedido montado em
  `lib/volund/agents.ts` leva exatamente o que o arquivo descreve, então mudar o
  código sem mudar o contrato falha. Ele confere **este** lado — a outra ponta
  cai na ressalva do fim desta página.

## Como mudar o contrato

Mudança nos claims é mudança de contrato: **os dois arquivos mudam juntos e o
número de `contract` sobe**. O `contract` é a trava que já existe — a plataforma
recusa um scaffold cujo contrato ela não suporta (`SUPPORTED_CONTRACT` em
`lib/apps/scaffold-source.ts`), então subir o número obriga a coordenação em vez
de deixá-la ao acaso.

**O que este arquivo NÃO faz:** ele não é uma dependência de build compartilhada.
Editar só uma das cópias deixa as duas suítes verdes. A trava contra isso é o
número de contrato e a revisão — não o arquivo.
