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
  imprima, nunca a versione.
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
| `migrations/` | Todo SQL aplicado ao banco, um arquivo por mudança                     |
| `tests/`      | Testes, com `.test.ts` no nome                                         |

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
