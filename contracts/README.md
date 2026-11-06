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

| Campo                                            | O que significa                                                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract`                                       | O contrato de scaffold a que este arquivo pertence. É o mesmo número de `volund-scaffold.json`, e é ele que a plataforma recusa quando não suporta.           |
| `accessToken.always`                             | Claims presentes em **todo** access token, independentemente do escopo.                                                                                       |
| `accessToken.scoped`                             | Claim → escopo que o libera. Sem o escopo, o claim **não sai** — é o que impede o token de virar "o perfil de quem o pediu".                                  |
| `session`                                        | Campo da sessão que o App enxerga → claim que o alimenta. É esta linha que estava quebrada no caso do `email`.                                                |
| `accessToken.conditional` / `sessionConditional` | Claim que depende do MODO da emissão (`act`, só quando um agente ou App age pela pessoa) e o campo da sessão que ele alimenta (`actor`, `null` fora do modo). |
| `modes` / `subjectTypes`                         | Os três modos de emissão (`user`, `delegated`, `own`) e os valores de `subject_type`, que viram `session.subjectType`.                                        |

## `agent-channel.json`

Descreve o **canal de agentes** (contrato 8, refeito no 9): como esta aplicação
atravessa a fronteira de audiência para falar com a plataforma **em nome de quem
está usando ela**, e o que recebe de volta.

| Campo          | O que significa                                                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exchange`     | Os valores do pedido de troca (RFC 8693): `grant_type`, os tipos de token, o caminho do `resource` e o escopo. Errar um deles vira recusa, não comportamento diferente.                       |
| `roster`       | O endereço e os campos do roteiro de agentes, lido em tempo de execução.                                                                                                                      |
| `embedSession` | A sessão do chat embutido em modo pessoa (contrato 9): corpo, resposta, `revoke` (`DELETE …/{sessionId}`), recusas com status, e `frame` — as mensagens `postMessage` entre o quadro e o App. |
| `headless`     | Chamar um agente por código no servidor: `volundFor` + `resolveAgentId`, sobre o `@volund-ia/sdk`.                                                                                            |
| `legacyProxy`  | As rotas de conversa do scaffold até o contrato 8, removidas no 9 — descritas para quem mantém um App gerado antes.                                                                           |

Duas coisas que ele fixa e que vale ler antes de mexer:

- **`serverOnlyFields`.** O roteiro traz o identificador do agente, e ele **não**
  atravessa o navegador. Se atravessasse, uma tela poderia endereçar qualquer
  agente da organização — e a oferta do App deixaria de ser oferta.
- **O token trocado também não.** Ao navegador chega só o `embed_url`, com um
  código de uso único que vence em 120 segundos — e o App recusa um `embed_url`
  fora da origem do emissor.

## `frame-protocol.json`

As mensagens entre o painel do VolundOS e um App emoldurado nele: o aviso de
rota (`appToPanel`), a navegação pedida pelo painel (`panelToApp`) e, no contrato
9, o tema da pessoa (`panelToAppTheme`). No contrato 10 entra a seleção de
elemento para comentar com o agente: o painel liga e desliga o modo (`pick`), e
a aplicação avisa que sabe selecionar (`pick-ready`), manda o elemento escolhido
(`picked`) e o Esc (`pick-cancel`). As duas pontas conferem origem exata e
janela, e nenhuma posta para `*`.

## `app-appearance.json`

A marca da organização (contrato 9): onde o App a lê (o
`volund_appearance_endpoint` da descoberta, ou `path`), as duas autenticações
que a plataforma aceita (`bearer` com o token da sessão, `basic` com o segredo do
App — o scaffold usa `basic`), os campos da resposta, os seletores do `css`, o
cache (`private, max-age=300`) e, em `app`, o que o lado do App faz: recusa `css`
que não seja texto ou contenha `</`, e segue com o tema padrão em qualquer falha.

## Os quatro arquivos são idênticos, byte a byte

`auth-claims.json`, `frame-protocol.json`, `agent-channel.json` e
`app-appearance.json` existem nos dois repositórios com o MESMO conteúdo. Cada
lado tem campos que só ele usa (`appRoute` e `app` são do scaffold;
`authentication.bearer` e `cache` são da plataforma), e eles ficam no arquivo
comum mesmo assim: duas versões "cada uma com o que precisa" foram exatamente o
que deixou o scaffold sem `subject_type` enquanto a plataforma o prometia.

`tests/contratos-identicos.test.ts` confere o sha256 de cada um contra uma lista
gravada no próprio teste, sem rede. Mudar um contrato é: editar, copiar para o
volund-os, conferir com `cmp`, e só então atualizar o hash. A formatação é a do
Prettier deste repositório (`npx prettier --write contracts/`), porque é aqui que
ela é conferida.

## Como as duas pontas usam

- **`volund-os`** (`tests/unit/oidc-contrato-de-claims.test.ts`): confere que
  `accessTokenClaims` emite exatamente isto — os `always` sempre, os `scoped`
  só com o escopo correspondente.
- **`volund-os-scaffold`** (`tests/auth-contrato-de-claims.test.ts`): confere
  que a sessão montada a partir desses claims chega com todos os campos
  preenchidos — nenhum `null` onde o contrato promete valor.
- **`agent-channel.json`** é conferido por
  `tests/volund-canal-do-agente.test.ts` (troca e roteiro) e
  `tests/volund-embed-sessao.test.ts` (sessão do chat embutido e nomes das
  mensagens): o pedido montado em `lib/volund/` leva exatamente o que o arquivo
  descreve, então mudar o código sem mudar o contrato falha. Ele confere
  **este** lado — a outra ponta cai na ressalva do fim desta página.
- **`frame-protocol.json`** é conferido por `tests/frame-vinculo-de-rota.test.ts`
  (rota, navegação e tema) e `tests/frame-selecao-de-elemento.test.ts` (seleção
  de elemento), e **`app-appearance.json`** por `tests/volund-aparencia.test.ts`.

## Como mudar o contrato

Mudança nos claims é mudança de contrato: **os dois arquivos mudam juntos e o
número de `contract` sobe**. O `contract` é a trava que já existe — a plataforma
recusa um scaffold cujo contrato ela não suporta (`SUPPORTED_CONTRACT` em
`lib/apps/scaffold-source.ts`), então subir o número obriga a coordenação em vez
de deixá-la ao acaso.

**O que este arquivo NÃO faz:** ele não é uma dependência de build compartilhada.
Editar só uma das cópias deixa as duas suítes verdes. A trava contra isso é o
número de contrato e a revisão — não o arquivo.
