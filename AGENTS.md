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

| Pasta         | Conteúdo                                                               |
| ------------- | ---------------------------------------------------------------------- |
| `app/`        | Rotas. Página é `page.tsx`; endpoint é `route.ts` dentro de `app/api/` |
| `components/` | Componentes de interface reutilizáveis, um por arquivo                 |
| `lib/`        | Acesso a dados, integrações, funções de apoio                          |
| `types/`      | Tipos usados por mais de um módulo                                     |
| `lib/auth/`   | Autenticação da plataforma. **Pronta — não reimplemente.** Veja abaixo |
| `migrations/` | Todo SQL aplicado ao banco, um arquivo por mudança                     |
| `tests/`      | Testes, com `.test.ts` no nome                                         |

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

**Sempre cheque no servidor, em cada limite.** Esconder um botão não protege
nada: quem chama a rota direto nunca viu o botão. E o proxy protege _rotas_ — uma
Server Action é um POST para a rota onde ela é usada, e mover um arquivo pode
tirar a cobertura sem nenhum aviso.

**Sobre permissões:** `can()` existe em `lib/auth/permissions.ts` e nega por
default, mas o catálogo de papéis por App ainda não existe na plataforma — hoje
todo token vem com a lista de permissões vazia, então `can()` devolve `false`
para todo mundo. Proteja com sessão (`guard()`); use `can()` só quando as
concessões existirem. Se você trancar uma tela com `can("algo")` agora, ninguém
entra — nem quem criou o App.

Se o usuário pedir "coloca um login no app", a resposta é que ele já tem: mostre
a `/` (vitrine, pública) e a `/painel` (protegida), que são o exemplo pronto.

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

**Toda rota de API valida a entrada.** Use `parseJsonBody`/`parseSearchParams`
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
