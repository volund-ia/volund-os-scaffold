# Instruções do repositório

Este é um **App do VolundOS**: uma aplicação Next.js + Postgres construída e
evoluída por um agente. Este arquivo é lido automaticamente por quem trabalha
aqui — siga-o.

## O ambiente

- O código roda ao vivo em `http://localhost:3000` com recarga automática. Cada
  arquivo salvo aparece em segundos para quem está acompanhando.
- **Não rode `npm run build`** para verificar seu trabalho: é pesado, pode
  derrubar o ambiente por falta de memória, e o servidor de desenvolvimento já
  mostra o erro real. Para conferir, chame a aplicação: `curl -s
http://localhost:3000/` ou `curl -s http://localhost:3000/api/...`.
- `DATABASE_URL` é injetada pela plataforma. Nunca a escreva em arquivo, nunca a
  imprima, nunca a versione. O mesmo vale para as três variáveis
  `VOLUND_OIDC_*` da autenticação.
- Precisa de uma biblioteca? `npm install <pacote>` — **uma de cada vez**. Duas
  instalações em paralelo no mesmo `node_modules` corrompem a árvore de
  dependências.

## Antes de dizer que terminou

```bash
npm run check    # formata (verifica), lint, tipos e testes
```

Os quatro precisam passar. `npm run format` corrige a formatação
automaticamente.

## Onde cada coisa mora

| Pasta           | Conteúdo                                                               |
| --------------- | ---------------------------------------------------------------------- |
| `app/`          | Rotas. Página é `page.tsx`; endpoint é `route.ts` dentro de `app/api/` |
| `components/`   | Componentes de interface reutilizáveis, um por arquivo                 |
| `lib/services/` | **A regra de negócio.** Uma decisão por serviço. Veja abaixo           |
| `lib/`          | Acesso a dados, integrações, funções de apoio                          |
| `types/`        | Tipos usados por mais de um módulo                                     |
| `lib/auth/`     | Autenticação da plataforma. **Pronta — não reimplemente.** Veja abaixo |
| `migrations/`   | Todo SQL aplicado ao banco, um arquivo por mudança                     |
| `tests/`        | Testes, com `.test.ts` no nome                                         |

## Autenticação

**Já existe, e é da plataforma.** A identidade de quem usa este App é a mesma da
organização no VolundOS. Você **não** implementa login, cadastro, senha,
recuperação de senha, tabela de usuários nem sessão — nada disso é seu, e criar
uma população de contas paralela deixaria de fora exatamente quem a plataforma já
autorizou.

**Toda rota nasce protegida.** O `proxy.ts` exige sessão em tudo, com uma única
exceção enumerada em `lib/auth/route-policy.ts`: a vitrine (`/`) e as duas rotas
de bootstrap do login. Uma página nova que você criar exige sessão sem você fazer
nada.

Para usar a identidade:

```ts
// Em página (Server Component): manda para o login e volta depois.
import { requireSession } from "@/lib/auth/server";
const session = await requireSession("/onde-estou");

// Em rota de API ou Server Action: devolve a resposta pronta quando barra.
import { guard } from "@/lib/auth/server";
const gate = await guard();
if (!gate.ok) return gate.response;
// gate.session.userId, .orgId, .email, .name

// Onde a ausência de sessão é aceitável (a vitrine, por exemplo):
import { getSession } from "@/lib/auth/server";
const session = await getSession(); // Session | null
```

**Arquivo em `public/` também exige sessão.** Se a vitrine precisar de uma
imagem, acrescente o caminho dela à lista de `lib/auth/route-policy.ts` — a pasta
inteira não é liberada de propósito, porque é onde arquivo interno acaba parando.
O sintoma de esquecer é a imagem não carregar, não um vazamento.

**Sempre cheque no servidor, em cada limite.** Esconder um botão não protege
nada: quem chama a rota direto nunca viu o botão. E o proxy protege _rotas_ — uma
Server Action é um POST para a rota onde ela é usada, e mover um arquivo pode
tirar a cobertura sem nenhum aviso.

**Sobre permissões:** quando o usuário pedir que só algumas pessoas possam fazer
alguma coisa ("fechar o mês é só comigo e com a Mayara", "o resto do time só
olha"), o caminho é o catálogo de permissões da plataforma — que **existe e está
no ar**. São dois passos, de donos diferentes:

1. **Você declara** o catálogo com a ferramenta `report_app_permissions`: as
   permissões e papéis que a aplicação tem, com chaves sem namespace
   (`fechar_mes`). Declarar não concede nada a ninguém.
2. **A pessoa concede**, na aba Segurança do App. Aí `session.permissions` chega
   preenchido e `can(session, "fechar_mes")` responde `true` para quem recebeu.

Entre os dois passos `can()` nega todo mundo, e isso é o projeto funcionando:
nenhum acesso nasce implícito. Declare, proteja com `can()` e **diga ao usuário
que ele precisa conceder na aba Segurança** — é um clique dele, não uma mudança
de código.

> **Não construa uma lista de administradores dentro do banco do App** — nem por
> e-mail, nem por id, nem uma "tabela de papéis" própria. Já aconteceu duas
> vezes: o resultado é uma lista paralela sem auditoria, sem revogação,
> invisível para quem administra a organização, e que precisa de você toda vez
> que muda. A pergunta que separa os caminhos é "quem muda quem pode o quê?" —
> se a resposta for "eu, editando código", está errado.

Proteger com sessão (`guard()`) continua sendo o portão de baixo, e vale para
todas as rotas por herança. `can()` é o segundo nível.

**Esconder um botão não protege, e mostrar um botão que o servidor nega
confunde.** As duas metades da mesma regra: a presença do controle na tela e a
decisão da rota saem do **mesmo** `can()`. Num App real a tela mostrava
"Liberar" para quem não podia, e o servidor recusava no clique — a proteção
estava certa, a interface é que prometia o que não existia para aquela pessoa.

Se o usuário pedir "coloca um login no app", a resposta é que ele já tem: mostre
a `/` (vitrine, pública) e a `/painel` (protegida), que são o exemplo pronto.

## Regra de negócio

**Toda decisão da aplicação mora em `lib/services/`.** Um serviço recebe a sessão
e a entrada, decide, e devolve resultado — `(session, entrada) → resultado`:

```ts
import { z } from "zod";

import { query } from "@/lib/db";
import { defineService } from "@/lib/services/define";
import { ok } from "@/lib/services/types";

export const publicarAviso = defineService({
  name: "publicar_aviso", // minúsculas com `_`, como as chaves de permissão
  summary: "Publica um aviso no quadro da organização.",
  kind: "write", // "read" quando o serviço só lê
  permission: "publicar_aviso", // do catálogo do App, sem namespace
  input: z.object({ texto: z.string().min(1).max(280) }),
  run: async (session, input) => {
    const res = await query<{ id: string }>(
      "insert into avisos (org_id, autor_id, texto) values ($1, $2, $3) returning id",
      [session.orgId, session.userId, input.texto],
    );
    return ok({ id: res.rows[0]?.id ?? null });
  },
});
```

Serviço novo entra em `lib/services/index.ts` na mesma mudança em que nasce.

**O que `defineService` faz por você** — e por isso você não repete em cada
serviço: recusa quem chega sem sessão, confere `can(session, permission)` antes de
rodar, valida a entrada pelo schema declarado e transforma exceção em falha
`internal` sem vazar detalhe de infraestrutura para quem chamou. Precisa de uma
checagem a mais (por registro, por dono)? Chame `can()` dentro de `run` — o portão
é o piso, não o teto.

**O serviço não conhece HTTP.** Nem resposta, nem status, nem cabeçalho, nem
cookie. Quem traduz é quem chama: uma página (Server Component) chama o serviço
direto, no mesmo processo, e mostra o que veio; um componente de cliente chama a
rota de API, e a rota chama o mesmo serviço. `app/painel/page.tsx` é o exemplo
pronto.

**A rota de API é o serviço mais uma linha:**

```ts
// app/api/avisos/route.ts
import { serviceRoute } from "@/lib/http/service-route";
import { publicarAviso } from "@/lib/services/avisos";

export const dynamic = "force-dynamic";
export const POST = serviceRoute(publicarAviso, { from: "json" });
```

`from: "json"` lê o corpo; `from: "query"` lê os parâmetros de query (`GET`). O
schema da entrada é o **do serviço** — não escreva um segundo aqui, porque dois
schemas divergem. A tradução de falha para status HTTP também é uma só
(`lib/http/service-route.ts`): sem sessão vira 401, sem permissão 403, entrada
inválida 400 com os campos, não encontrado 404, conflito 409, falha interna 500
sem detalhe de infraestrutura.

Precisa de algo que o adaptador não cobre — parâmetro de caminho, cabeçalho,
upload? Escreva o handler à mão, chame o serviço e devolva
`serviceResponse(resultado)`. O que **não** se faz é conferir permissão na rota:
quem responde "esta pessoa pode?" é o serviço, e é a mesma resposta que a tela
usa. `app/api/echo/route.ts` (sem permissão) e `app/api/diagnostico/route.ts`
(protegida) são os dois exemplos prontos.

**Por que a decisão não mora na página nem na rota.** Porque a mesma decisão é
alcançada por mais de uma porta, e regra escrita duas vezes diverge na terceira
mudança — sem dar erro, só respondendo diferente em cada porta para a mesma
pergunta. Numa aplicação de reservas isso é a API marcar uma sala que a tela não
deixaria marcar, e o dono da sala descobrir depois.

**Serviço que não exige permissão** declara `permission: null` **e** tem o nome
listado em `lib/services/policy.ts`, com o motivo ao lado. As duas coisas, porque
público por decisão e público por esquecimento são idênticos em tempo de execução
— só a declaração os separa. `defineService` recusa a definição que tenha uma sem
a outra. Sessão continua sendo exigida em todos: "público" aqui é sobre permissão,
não sobre sessão.

## Interface

A biblioteca de componentes é **shadcn/ui** (sobre Base UI), já instalada. Um
conjunto base vive em `components/ui/`: `button`, `card`, `input`, `label`,
`textarea`, `select`, `checkbox`, `dialog`, `dropdown-menu`, `tabs`, `badge`,
`separator`, `skeleton` e `sonner`.

**Use o que já existe antes de escrever CSS.** Precisa de um componente que não
está aí?

```bash
npx shadcn add <componente>   # CLI local, versão travada no lockfile
npm run format                # o código gerado não sai no formato do projeto
```

Use o CLI **local** (sem `@latest`): ele é a mesma versão que gerou os
componentes que já estão aqui, então o que você adicionar combina com o resto.

Os componentes de `components/ui/` são a base; o que for específico da aplicação
vai em `components/`, compondo os de baixo.

**Cores e espaçamento saem dos tokens do tema** (`bg-background`,
`text-foreground`, `bg-primary`, `border-border`…), definidos em
`app/globals.css`. Não escreva cor literal: o tema tem modo claro e escuro, e cor
fixa quebra um dos dois.

**Não adicione webfont.** O `layout.tsx` usa a pilha do sistema de propósito —
`next/font/google` faz o build baixar arquivos de fonte da rede. Se o produto
exigir uma fonte específica, é decisão do usuário, não default.

## Regras que não se negociam

**Toda rota de API valida a entrada.** Numa rota sobre serviço isso vem de
graça: quem valida é o schema do serviço, e `serviceRoute` traduz a recusa em 400
com os campos. Num handler escrito à mão, use `parseJsonBody`/`parseSearchParams`
de `lib/validation.ts`. Dado que vem do cliente é `unknown` até ser validado —
`as` não valida nada, só silencia o compilador.

**Todo SQL aplicado vira arquivo em `migrations/`.** Sem isso o schema existe só
dentro do banco: ninguém revisa, e clonar o repositório não reconstrói a
aplicação. Numeração sequencial (`0001_...`), uma mudança por arquivo, e nunca
edite um arquivo já aplicado — a plataforma guarda o checksum e recusa conteúdo
divergente.

**Mensagem de erro de infraestrutura não vai para a resposta HTTP.** A mensagem
do driver de banco carrega host, porta e configuração; as rotas são públicas.
Registre o detalhe com `console.error` (o provedor de deploy coleta) e responda
algo genérico. `app/api/health/route.ts` é o exemplo.

**Sem `any`.** Se o tipo é desconhecido, use `unknown` e estreite. O lint
reprova `any`.

**Componente que só apresenta dado não busca dado.** Quem busca é a página ou uma
função em `lib/`, e passa por prop.

**Não versione segredo.** Nem em exemplo, nem em teste, nem em comentário. Este
repositório pode ser público.

## Banco de dados

`lib/db.ts` expõe `query(sql, params)` sobre um pool único. Use parâmetros
(`$1`, `$2`), nunca interpolação de string — é injeção de SQL esperando
acontecer.

O schema é seu para desenhar: crie as tabelas que a aplicação precisa,
registrando cada mudança em `migrations/`.

## Publicação

**Você não publica.** Quem publica é a pessoa, pelo botão da interface do
VolundOS. Trabalhe na branch de trabalho; quando algo estiver pronto, diga a ela.
