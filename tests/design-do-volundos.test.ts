// A identidade visual do VolundOS chega ao App — e continua chegando.
//
// ## Por que estes testes existem
//
// Cada decisão aqui é do tipo que uma ferramenta desfaz sem avisar. Um
// `shadcn init` futuro reescreve `app/globals.css` com o tema claro default e
// devolve o bloco `.dark`; um `create-next-app` de referência traz
// `next/font/google` de volta. Nenhuma das duas coisas dá erro: o App
// simplesmente volta a nascer branco, ou o build volta a depender da rede — e
// isso só aparece quando alguém publica e estranha.
//
// O que se guarda:
//
//   1. o tema é o do VolundOS (fundo escuro, crimson), com o par claro do
//      contrato 9 no atributo `data-tema` — e nunca na classe `.dark`;
//   2. nenhuma fonte é buscada na rede durante o build;
//   3. o `DESIGN.md` existe e é lido pela plataforma — ele é o que entra no
//      system prompt do agente, e sem arquivo não há diretriz;
//   4. as páginas de exemplo não escrevem cor literal, porque são elas que o
//      agente copia.
//
// Rodar: npx tsx --test tests/design-do-volundos.test.ts
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.join(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

/** Todo `.ts`/`.tsx` do projeto, fora de `node_modules` e `.next`. */
function sourceFiles(dir = root, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(path.relative(root, full));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. O tema é o do VolundOS, e é único
// ---------------------------------------------------------------------------

test("o tema é escuro e o acento é o crimson do VolundOS", () => {
  const css = read("app/globals.css");

  // O crimson do VolundOS, no valor que a PLATAFORMA usa — é o que faz um App
  // parecer parte dela em vez de um projeto qualquer com shadcn.
  //
  // Ele não é a conversão exata de `#ED3B62` (essa seria
  // `oklch(0.6308 0.2126 13.67)`; a diferença é ~1% de luminosidade). A asserção
  // é sobre o valor da plataforma de propósito: um App com o crimson "mais
  // correto" que o do produto fica visivelmente diferente ao lado dele, o que é
  // o oposto do objetivo.
  assert.match(css, /--primary:\s*oklch\(0\.62 0\.21 13\)/, "o crimson saiu do tema");
  // Fundo escuro e WARM: o `oklch(1 0 0)` do shadcn é branco puro.
  assert.match(
    css,
    /--background:\s*oklch\(0\.0\d+ 0\.0\d+ 12\)/,
    "o fundo deixou de ser escuro",
  );
  assert.doesNotMatch(
    css,
    /--background:\s*oklch\(1 0 0\)/,
    "o tema claro do shadcn voltou",
  );
});

/** O corpo do bloco do tema claro, ou `null` se ele não existir. */
function blocoClaro(css: string): string | null {
  const m = /^:root\[data-tema="claro"\]\s*\{([^}]*)\}/m.exec(css);
  return m?.[1] ?? null;
}

test("o tema claro existe, no atributo `data-tema`, e é claro de verdade", () => {
  const css = read("app/globals.css");
  const claro = blocoClaro(css);
  assert.ok(claro, 'o bloco `:root[data-tema="claro"]` sumiu do globals.css');

  // `color-scheme` acompanha: sem ele, barra de rolagem e campo nativo ficam
  // escuros sobre a página clara.
  assert.match(claro, /color-scheme:\s*light/);
  assert.match(css, /:root\s*\{[^}]*color-scheme:\s*dark/);

  // O fundo do claro é CLARO — um bloco que só repetisse o escuro passaria na
  // asserção de existência acima.
  const fundo = /--background:\s*oklch\((0\.\d+|1)\b/.exec(claro);
  assert.ok(fundo?.[1], "o bloco claro não declara --background");
  assert.ok(Number(fundo[1]) > 0.9, `o fundo do claro tem luminosidade ${fundo[1]}`);

  // Os tokens que o DESIGN.md manda usar têm par no claro. Um que faltasse
  // ficaria com o valor do escuro (branco translúcido) sobre fundo branco — some.
  for (const token of [
    "--foreground",
    "--card",
    "--muted-foreground",
    "--border",
    "--surface",
    "--surface-elevated",
    "--surface-interactive",
    "--surface-interactive-hover",
    "--border-subtle",
    "--border-strong",
  ]) {
    assert.ok(
      claro.includes(`${token}:`),
      `o token ${token} não tem par no tema claro`,
    );
  }
  // E nenhum branco translúcido sobrou nele.
  assert.doesNotMatch(
    claro,
    /oklch\(1 0 0 \//,
    "o claro tem branco translúcido do escuro",
  );

  // A variante para a exceção rara: `claro:`, na mesma convenção do painel.
  assert.match(css, /@custom-variant claro \(&:is\(\[data-tema="claro"\] \*\)\);/);
});

test("o seletor do claro fica entre as duas camadas da marca da organização", () => {
  // A marca chega com `html:root` (0,1,1) e `html:root[data-tema="claro"]`
  // (0,2,1) — contracts/app-appearance.json. O claro do scaffold precisa vencer
  // a marca ESCURA e perder para a marca CLARA: com `html[data-tema="claro"]`
  // (0,1,1) ele empataria com a escura, e quem ganha passaria a ser a ordem dos
  // arquivos.
  const css = read("app/globals.css");
  assert.doesNotMatch(css, /^html\[data-tema="claro"\]\s*\{/m);
  const contrato = JSON.parse(read("contracts/app-appearance.json")) as {
    response: { css: { darkSelector: string; lightSelector: string } };
  };
  assert.equal(contrato.response.css.darkSelector, "html:root");
  assert.equal(contrato.response.css.lightSelector, 'html:root[data-tema="claro"]');
});

test("a classe `.dark` continua de fora — o claro é o atributo, não um segundo tema por classe", () => {
  const css = read("app/globals.css");
  // O bloco `.dark` do shadcn voltando significaria uma TERCEIRA aparência, que
  // ninguém liga: quem escolhe o tema é o VolundOS, pelo atributo.
  assert.doesNotMatch(
    css,
    /^\.dark\s*\{/m,
    "o bloco `.dark` voltou — o claro é `data-tema`, ver DESIGN.md",
  );
  // E ninguém volta a pôr a classe no <html>, nem o `next-themes` que a põe.
  const culpados = sourceFiles().filter((f) =>
    /from ["']next-themes["']|classList\.(add|toggle)\(["']dark["']/.test(read(f)),
  );
  assert.deepEqual(
    culpados,
    [],
    `estes arquivos usam a classe .dark: ${culpados.join(", ")}`,
  );
});

test("o tema é aplicado antes da primeira pintura", () => {
  // Sem o script no <head>, quem está no claro vê a página nascer escura e
  // piscar na hidratação.
  const layout = read("app/layout.tsx");
  assert.match(
    layout,
    /<script dangerouslySetInnerHTML=\{\{ __html: THEME_BEFORE_PAINT_SCRIPT \}\} \/>/,
  );
  assert.match(layout, /suppressHydrationWarning/);
});

test("as superfícies semânticas existem, para ninguém inventar `bg-white/[0.03]`", () => {
  const css = read("app/globals.css");
  for (const token of [
    "--surface",
    "--surface-elevated",
    "--surface-interactive",
    "--border-subtle",
    "--border-strong",
  ]) {
    assert.ok(css.includes(`${token}:`), `o token ${token} sumiu do tema`);
  }
  // E expostos ao Tailwind, senão `bg-surface` não existe como classe.
  assert.match(css, /--color-surface:\s*var\(--surface\)/);
});

// ---------------------------------------------------------------------------
// 2. Nenhuma fonte vem da rede
// ---------------------------------------------------------------------------

test("nada importa `next/font/google`", () => {
  // O motivo não é preferência: `next/font/google` faz o `next build` baixar de
  // `fonts.gstatic.com`, e um build da plataforma caiu com
  // `Can't resolve '@vercel/turbopack-next/internal/font/google/font'`. O build de
  // um App é o caminho entre o agente terminar e o usuário ver a tela.
  // O IMPORT, e não a menção ao nome. Arquivos podem legitimamente falar do
  // assunto: o comentário do `layout.tsx` explica por que aquele módulo está
  // fora, e este teste inteiro fala dele. Reprovar por menção me faria apagar a
  // explicação para o teste passar — o oposto do que ele existe para proteger.
  // (Este teste já falhou exatamente assim, na primeira versão.)
  const IMPORTA = /(?:from|import|require)\s*\(?\s*["']next\/font\/google["']/;
  const culpados = sourceFiles().filter((f) => IMPORTA.test(read(f)));
  assert.deepEqual(
    culpados,
    [],
    `estes arquivos buscam fonte na rede: ${culpados.join(", ")}`,
  );
});

test("as fontes estão versionadas e carregadas de arquivo local", () => {
  const layout = read("app/layout.tsx");
  assert.match(layout, /from "next\/font\/local"/);

  // Os arquivos precisam EXISTIR: um `localFont` apontando para caminho que não
  // existe quebra o build, e é fácil perder um woff2 num rebase.
  const fontes = readdirSync(path.join(root, "public/fonts"));
  for (const f of [
    "inter-latin-variable.woff2",
    "dm-mono-300.woff2",
    "dm-mono-400.woff2",
    "dm-mono-500.woff2",
  ]) {
    assert.ok(fontes.includes(f), `falta ${f} em public/fonts`);
  }
  // Licença junto do arquivo: os dois são SIL Open Font License, e empacotar
  // fonte sem a licença é problema de licença, não de build.
  assert.ok(
    fontes.some((f) => /OFL.*Inter/i.test(f)) && fontes.some((f) => /OFL.*DM/i.test(f)),
    "faltou o arquivo de licença de alguma das fontes",
  );
});

// ---------------------------------------------------------------------------
// 3. A diretriz existe — é ela que a plataforma injeta no prompt do agente
// ---------------------------------------------------------------------------

test("o DESIGN.md existe e cabe no bloco de diretrizes da plataforma", () => {
  const design = read("DESIGN.md");
  const agents = read("AGENTS.md");

  // A plataforma lê `AGENTS.md`, `CLAUDE.md` e `DESIGN.md` do repositório e os
  // injeta no system prompt (ver `lib/agent/v2/repo-guidelines.ts` no volund-os),
  // com teto de 32 KB por arquivo e 64 KB no bloco. Estourar não dá erro: o
  // arquivo entra truncado, e o agente age como se tivesse lido tudo.
  const KB = 1024;
  assert.ok(
    Buffer.byteLength(design, "utf8") < 32 * KB,
    "o DESIGN.md passou de 32 KB e vai entrar truncado no prompt do agente",
  );
  assert.ok(
    Buffer.byteLength(design, "utf8") + Buffer.byteLength(agents, "utf8") < 64 * KB,
    "AGENTS.md + DESIGN.md passaram de 64 KB — o bloco inteiro é cortado",
  );

  // O conteúdo que não pode faltar, porque é o que muda o que o agente desenha.
  assert.match(design, /tokens/i, "o DESIGN.md tem de falar dos tokens");
  assert.match(design, /#ED3B62|primary/, "o DESIGN.md tem de dizer qual é o acento");
  assert.match(
    design,
    /skeleton/i,
    "o DESIGN.md tem de exigir skeleton no carregamento",
  );
  assert.match(design, /title=/, "o DESIGN.md tem de proibir o `title` do navegador");
});

test("o AGENTS.md manda ler o DESIGN.md", () => {
  // A plataforma injeta os dois, mas a ordem no prompt põe o `AGENTS.md`
  // primeiro. Ele apontar para o outro é o que evita a leitura em diagonal.
  assert.match(read("AGENTS.md"), /DESIGN\.md/);
});

// ---------------------------------------------------------------------------
// 4. As páginas de exemplo são exemplo de verdade
// ---------------------------------------------------------------------------

test("a vitrine e o painel não escrevem cor literal", () => {
  // São as duas telas que o agente lê antes de escrever a primeira dele. Uma cor
  // literal aqui é uma cor literal em toda tela que ele criar depois.
  for (const page of ["app/page.tsx", "app/painel/page.tsx"]) {
    const src = read(page);
    assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, `${page} tem cor em hexadecimal`);
    assert.doesNotMatch(src, /rgba?\(/, `${page} tem cor em rgb`);
    assert.doesNotMatch(
      src,
      /bg-white\/|text-white\/|border-white\//,
      `${page} usa branco cru`,
    );
  }
});
