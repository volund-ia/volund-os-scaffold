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
//   1. o tema é o do VolundOS (fundo escuro, crimson) e é ÚNICO;
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

  // `#ED3B62` em OKLch. O valor está no DESIGN.md do produto, e é o que faz um
  // App parecer parte dele em vez de um projeto qualquer com shadcn.
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

test("não existe um SEGUNDO tema", () => {
  const css = read("app/globals.css");
  // O bloco `.dark` foi removido de propósito: dark-mode only. Ele voltando
  // significa duas aparências, das quais só uma é olhada.
  assert.doesNotMatch(
    css,
    /^\.dark\s*\{/m,
    "o bloco `.dark` voltou — o tema é único, ver DESIGN.md",
  );
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
