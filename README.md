# volund-os-scaffold

Base de aplicação usada pelos **Apps** do [VolundOS](https://os.volund.com.br):
**Next.js 16** (App Router) + **Postgres**, TypeScript, Tailwind v4.

Quando um App é criado, esta base é extraída no ambiente do agente **com
`node_modules` já instalado** — o primeiro prompt não paga instalação de
dependências.

## O que vem pronto

|               |                                                                 |
| ------------- | --------------------------------------------------------------- |
| Aplicação     | Next.js (App Router), React 19, Tailwind v4                     |
| Banco         | `pg` com pool único em `lib/db.ts`, conexão por `DATABASE_URL`  |
| Validação     | `zod` + helpers de fronteira em `lib/validation.ts`             |
| Estados de UI | `error.tsx`, `not-found.tsx`, `loading.tsx`                     |
| Qualidade     | ESLint, Prettier, `tsc` estrito, testes com `node:test` + `tsx` |
| Convenção     | `AGENTS.md` com as regras que o agente segue neste repositório  |

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

A release não é o código-fonte: é um `.zip` com o projeto **e o `node_modules`
instalado**, que é o que permite o ambiente subir em segundos em vez de pagar uma
instalação a cada App novo.

O `.zip` é montado e publicado pelo pipeline do repositório a cada tag `vX.Y.Z`.
Se você forkou, o mesmo pipeline vem no fork — basta criar uma tag.

## Contrato

`volund-scaffold.json` declara o que a plataforma pode esperar deste
repositório: versão do contrato, comandos, porta, variáveis exigidas e o formato
do artefato. É por ele que o VolundOS valida um fork antes de aceitá-lo — mexa
com cuidado.

## Licença

MIT. Veja [LICENSE](./LICENSE).
