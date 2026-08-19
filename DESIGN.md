# Design

A aparência deste app não é escolha livre: ele vive dentro do VolundOS e precisa
parecer parte dele. As regras abaixo já estão implementadas no projeto — este
arquivo diz o que usar e, principalmente, o que **não** fazer.

O tema é **escuro, único**. Não existe modo claro, não existe toggle, não se
escreve `dark:`. Uma tela com duas aparências tem uma que ninguém testou.

---

## Cores: os tokens, nunca o literal

```tsx
// certo
<div className="bg-surface border-border-subtle text-foreground">
<span className="text-muted-foreground">
<button className="bg-primary text-primary-foreground">

// errado
<div className="bg-[#0a0a0a] border-white/5 text-white">
<div style={{ background: "rgba(255,255,255,0.03)" }}>
```

Cor literal quebra na primeira vez que o tema muda, e some do radar porque não dá
erro. Os tokens estão em `app/globals.css`:

| token                                               | para quê                                       |
| --------------------------------------------------- | ---------------------------------------------- |
| `background` / `foreground`                         | o fundo da página e o texto principal          |
| `surface`                                           | cartão sobre o fundo                           |
| `surface-elevated`                                  | cartão sólido, em listagens                    |
| `surface-interactive` / `surface-interactive-hover` | linha clicável, parada e sob o cursor          |
| `border-subtle` / `border-strong`                   | borda normal e borda em hover                  |
| `muted-foreground`                                  | texto secundário (é um cinza WARM, não neutro) |
| `primary`                                           | o acento — leia a próxima seção antes de usar  |
| `destructive`                                       | erro                                           |

## O crimson tem peso

`primary` é o crimson do VolundOS — `oklch(0.62 0.21 13)`, o MESMO valor que o
produto usa — e é o **único** acento intenso. Ele fica perto de `#ED3B62`, mas não
é a conversão exata (essa seria `oklch(0.6308 0.2126 13.67)`): o que importa aqui é
bater com o token da plataforma, não com o hexadecimal. Se algum dia os dois
divergirem, o valor da plataforma ganha. Ele marca a ação principal
da tela — uma por tela. Publicar, salvar, conceder: essas ganham `bg-primary`.
Trocar credencial, cancelar, filtrar, exportar: essas são secundárias
(`bg-secondary` ou só borda).

Quando tudo é crimson, nada é. E a ação de rotina com o botão mais forte da tela
é o erro mais comum aqui — ele faz a pessoa clicar no que não devia.

Proibido: gradiente em texto (`background-clip: text`), emoji, itálico.

## Tipografia

Duas fontes, ambas já carregadas em `app/layout.tsx` a partir de
`public/fonts/` — **não** adicione webfont, e não busque fonte na rede no build.

- **Inter** (`font-sans`): tudo. Títulos com tracking negativo — quanto maior, mais
  fechado: `tracking-[-0.01em]` num título de cartão, `-0.025em` num título de
  página.
- **DM Mono** (`font-mono`): rótulo de seção, timestamp, id, valor técnico curto.
  Em caixa alta com `tracking-[0.14em]` quando for rótulo.

```tsx
<h2 className="text-[22px] font-medium tracking-[-0.01em]">Recados</h2>
<span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
  Publicados
</span>
<time className="font-mono text-[11.5px] text-muted-foreground">14:32</time>
```

Escala de corpo: `text-[15px]` com `leading-[1.65]` para texto de leitura,
`text-[13px]` para apoio.

## Ícones

`lucide-react`, que já está instalado e é o que os componentes de `components/ui/`
usam. Não instale uma segunda biblioteca de ícones: duas famílias na mesma tela se
notam na hora, no peso do traço.

Tamanhos: 14 numa etiqueta, 16–18 no uso normal, 20 numa ação de destaque. Nunca
escreva SVG inline como decoração — um check ou uma seta é componente, não caminho
desenhado à mão.

(O VolundOS usa Heroicons; aqui é Lucide porque é o que vem com a biblioteca de
componentes. O que precisa combinar é o tamanho e o peso do traço, não a família.)

## Toda ação precisa de resposta visível

Sem exceção. Botão que dispara algo assíncrono:

```tsx
<button disabled={salvando} className="bg-primary ...">
  {salvando ? <Spinner /> : null}
  {salvando ? "Publicando…" : "Publicar"}
</button>
```

1. spinner no lugar do ícone;
2. `disabled` enquanto roda, para não haver clique duplo;
3. volta ao normal só quando a operação termina.

E **carregando não é tela vazia**: use `Skeleton` (de `components/ui/skeleton`) na
forma do conteúdo que vai chegar. Devolver `null` enquanto carrega faz o conteúdo
brotar e empurrar o resto — e numa página inteira, faz parecer defeito.

Lista sem itens tem **empty state** com uma frase que diz o que fazer, não um
espaço em branco.

## Tooltip é componente

Nunca o atributo `title` do navegador: ele não tem controle de atraso, ignora o
resto do sistema visual e não é acessível por teclado. Se não houver um
componente de tooltip no projeto, `npx shadcn add tooltip`.

## Os dois padrões que você mais vai desenhar

**Cartão.** `rounded-[16px] border border-border-subtle bg-surface p-6`, título em
`text-[15px] font-medium`, corpo em `text-[13px] text-muted-foreground`.

**Linha interativa** (listas, itens de menu, resultados):

```tsx
<Link className="group border-border-subtle bg-surface hover:border-border-strong flex items-center gap-3 rounded-[14px] border px-3.5 py-3 transition-colors">
  <div className="min-w-0 flex-1">
    <span className="truncate text-[14px] font-medium">{titulo}</span>
    <p className="text-muted-foreground mt-0.5 truncate text-[12.5px]">{apoio}</p>
  </div>
  <ChevronRightIcon className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5" />
</Link>
```

## Escrita

Português do Brasil, e quem lê **não é técnico**. Proibido na interface: nome de
modelo, id de sandbox, "token", "endpoint", "chunk", "embedding". Diga o que
acontece com a pessoa, não como o sistema faz.

Uma frase por ideia. Se um cartão precisa de três parágrafos para se explicar, o
problema é o cartão.

## Antes de dizer que a tela está pronta

- [ ] nenhuma cor literal — só tokens;
- [ ] um único `bg-primary` na tela, na ação principal;
- [ ] toda ação assíncrona com spinner e `disabled`;
- [ ] carregando mostra skeleton, vazio mostra empty state;
- [ ] nenhum `title=`, nenhum emoji, nenhum SVG decorativo inline;
- [ ] 375px de largura no devtools: nada estoura, nada fica ilegível.
