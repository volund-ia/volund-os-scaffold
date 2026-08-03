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

## Como as duas pontas usam

- **`volund-os`** (`tests/unit/oidc-contrato-de-claims.test.ts`): confere que
  `accessTokenClaims` emite exatamente isto — os `always` sempre, os `scoped`
  só com o escopo correspondente.
- **`volund-os-scaffold`** (`tests/auth-contrato-de-claims.test.ts`): confere
  que a sessão montada a partir desses claims chega com todos os campos
  preenchidos — nenhum `null` onde o contrato promete valor.

## Como mudar o contrato

Mudança nos claims é mudança de contrato: **os dois arquivos mudam juntos e o
número de `contract` sobe**. O `contract` é a trava que já existe — a plataforma
recusa um scaffold cujo contrato ela não suporta (`SUPPORTED_CONTRACT` em
`lib/apps/scaffold-source.ts`), então subir o número obriga a coordenação em vez
de deixá-la ao acaso.

**O que este arquivo NÃO faz:** ele não é uma dependência de build compartilhada.
Editar só uma das cópias deixa as duas suítes verdes. A trava contra isso é o
número de contrato e a revisão — não o arquivo.
