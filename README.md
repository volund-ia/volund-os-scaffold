# volund-os-scaffold

Base de aplicação usada pelos **Apps** do [VolundOS](https://os.volund.com.br):
**Next.js 16** (App Router) + **Postgres**, TypeScript, Tailwind v4.

Quando um App é criado, esta base é extraída no ambiente do agente **com
`node_modules` já instalado** — o primeiro prompt não paga instalação de
dependências.

## O que vem pronto

|                |                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Aplicação      | Next.js (App Router), React 19, Tailwind v4                                                                                                            |
| Banco          | `pg` com pool único em `lib/db.ts`, conexão por `DATABASE_URL`                                                                                         |
| Autenticação   | OIDC da plataforma, sessão selada em cookie — sem cadastro próprio                                                                                     |
| Agentes do app | chat embutido do VolundOS em `/agentes`, em nome de **quem está conversando** (sem chave de API); chamada por código no servidor pelo `@volund-ia/sdk` |
| Tema e marca   | claro e escuro decididos pelo VolundOS (painel ou aparelho); logo, ícone e cores da organização vindos da plataforma                                   |
| Validação      | `zod` + helpers de fronteira em `lib/validation.ts`                                                                                                    |
| Interface      | **shadcn/ui** (sobre Base UI), 14 componentes base + CLI local                                                                                         |
| Estados de UI  | `error.tsx`, `not-found.tsx`, `loading.tsx`                                                                                                            |
| Qualidade      | ESLint, Prettier, `tsc` estrito, testes com `node:test` + `tsx`                                                                                        |
| Convenção      | `AGENTS.md` com as regras que o agente segue neste repositório                                                                                         |

## Agentes do app

A conversa é o **chat embutido do VolundOS** em modo pessoa, e não um chat do
scaffold. O servidor do App troca o token da sessão de quem está usando
(RFC 8693), cria a sessão em `POST /api/v1/apps/me/embed-sessions` e a tela mostra
o quadro (`components/volund/agent-embed.tsx`), que acompanha o tema do App e se
renova antes de vencer (`POST /api/volund/embed-session`).

Para chamar um agente **por código**, no servidor e sem tela:

```ts
import { resolveAgentId, volundFor } from "@/lib/volund/agents";

const volund = await volundFor(session); // token da troca, nunca no navegador
const { agentId } = await resolveAgentId(session, "suporte");
const { output } = await (await volund.agents.run({ agentId, input: "…" })).result();
```

## Tema e marca

O escuro é o `:root` de `app/globals.css`; o claro é `data-tema="claro"` no
`<html>`. Emoldurado no painel, o App segue o tema da pessoa no VolundOS (mensagem
`theme` de `contracts/frame-protocol.json`); aberto direto, segue
`prefers-color-scheme`. A marca da organização vem de `GET /oauth/app-appearance`
(`lib/volund/appearance.ts`) e, se a plataforma não responder, o App abre com o
tema padrão.

## Comandos

```bash
npm run dev           # servidor de desenvolvimento
npm run check         # formatação + lint + tipos + testes
npm test              # só os testes
npm run build         # build de produção
```

## Usar a sua própria versão

Este repositório é público e **forkável**. Uma organização pode apontar o
VolundOS para o próprio fork e ter todo App novo criado a partir dele — com os
componentes, as convenções e as dependências da casa.

1. **Fork** este repositório.
2. Ajuste o que quiser (componentes, `AGENTS.md`, dependências, tema).
3. **Publique uma release** com o artefato (ver abaixo).
4. No VolundOS, em **Configurações → Infraestrutura**, aponte para o seu
   `owner/repo`.

O VolundOS sempre usa a **última release** do repositório apontado.

## O artefato de release

A release não é o código-fonte: é o `scaffold.zip`, com o projeto **e o
`node_modules` instalado**. É isso que permite o ambiente de um App novo subir em
segundos em vez de pagar uma instalação de dependências a cada criação.

Publicar é criar uma tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

O pipeline (`.github/workflows/release.yml`) roda a verificação completa, o build,
monta o artefato e cria a release já com o `scaffold.zip` anexado. Quem publica é
o próprio workflow, com a credencial nativa do GitHub Actions — **um fork não
precisa configurar segredo nenhum**, basta criar a tag.

Rodar a mesma tag de novo substitui o asset, em vez de falhar.

Para montar o artefato localmente (o CI faz isso em cada PR, como validação):

```bash
npm ci && ./scripts/pack.sh
```

O script recusa artefato incompleto: valida que `package.json`, `.gitignore`, o
manifest e o binário do Next estão dentro, que o nome sentinela do pacote não
mudou, e que a infraestrutura deste repositório (`.github/`, `scripts/`) **não**
viajou para dentro do app gerado.

## Verificação automática

`.github/workflows/ci.yml` roda em todo PR e push na `main`: `npm run check`
(formatação, lint, tipos, testes), build de produção e montagem do artefato.

Este repositório é a base de **todo** App criado no VolundOS — um erro aqui se
multiplica por app gerado, e é por isso que o gate é o mesmo que o agente roda
dentro do container.

## Contrato

`volund-scaffold.json` declara o que a plataforma pode esperar deste
repositório: versão do contrato, comandos, porta, variáveis exigidas e o formato
do artefato. É por ele que o VolundOS valida um fork antes de aceitá-lo — mexa
com cuidado.

## Licença

MIT. Veja [LICENSE](./LICENSE).
