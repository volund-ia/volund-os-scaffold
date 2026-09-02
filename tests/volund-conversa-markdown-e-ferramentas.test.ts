// Como a conversa APARECE: Markdown na resposta e a chamada de ferramenta que
// dá para abrir.
//
// ## Por que estes casos são sobre a fonte
//
// Não há renderizador de React nesta suíte, e trazer um só para estes casos
// custaria mais do que resolve. A escolha é a mesma de `design-do-volundos`: o
// que se guarda são DECISÕES que uma edição futura desfaz sem dar erro — e cada
// asserção aqui está recortada no trecho que decide, não no arquivo inteiro.
//
// O recorte importa. "`text-primary` aparece no componente de Markdown" seria
// verdade pelo LINK, e passaria mesmo se o código inline voltasse a ser coral —
// que é justamente o que se quer impedir. Por isso os casos abaixo fatiam a
// fonte no mapeamento do elemento antes de afirmar qualquer coisa.
//
// O que cada caso protege:
//
//  - A resposta passa pelo Markdown, e não por `whitespace-pre-wrap`. É a
//    regressão que volta calada: o texto continua na tela, só que com os
//    asteriscos e os pipes da tabela à vista.
//  - Os dados da ferramenta são RETIDOS. Os eventos trazem o que ela recebeu e
//    devolveu, e o chat os descartava — sem isto o bloco abre vazio.
//  - Código inline não é coral, e o link é. É o raciocínio de
//    `components/ui/prose.ts` do produto, que é o que se está portando.
//  - Não há `@tailwindcss/typography`. O plugin entraria no `package.json` de
//    todo App criado a partir daqui, para estilizar uma superfície só.
//  - Os anexos chegam ao SDK nos DOIS caminhos: conversa nova e continuação.
//    Passar só em `run` deixaria o anexo funcionar na primeira mensagem e sumir
//    na segunda.
//
// Rodar: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const raiz = path.join(__dirname, "..");
const ler = (rel: string) => readFileSync(path.join(raiz, rel), "utf8");

const CHAT = "components/volund/agent-chat.tsx";
const MARKDOWN = "components/volund/agent-markdown.tsx";
const BLOCO = "components/volund/tool-call-block.tsx";
const ROTA = "app/api/volund/agents/[key]/stream/route.ts";

/**
 * A fonte sem comentário.
 *
 * Necessário para qualquer varredura que procure ALGO QUE NÃO DEVE EXISTIR: um
 * arquivo que explica por escrito por que não usa uma coisa contém o nome dela,
 * e a varredura casaria a explicação em vez do código.
 */
function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");
}

/**
 * O trecho que mapeia UM elemento no `components` do react-markdown.
 *
 * Vai de `<elemento>: (` até o começo do mapeamento seguinte. Sem esse fim, um
 * `slice` de tamanho fixo engoliria o vizinho — e é o vizinho que tem o coral.
 */
function mapeamentoDe(fonte: string, elemento: string): string {
  const inicio = fonte.indexOf(`${elemento}: (`);
  assert.ok(inicio > 0, `o mapeamento de \`${elemento}\` não existe`);
  const resto = fonte.slice(inicio + elemento.length + 4);
  // O próximo mapeamento começa com uma chave no mesmo nível de indentação.
  const fim = resto.search(/\n {10}[a-z]+: /);
  return fim > 0 ? resto.slice(0, fim) : resto;
}

// ---------------------------------------------------------------------------
// A resposta em Markdown
// ---------------------------------------------------------------------------

test("a resposta do agente passa pelo Markdown, não por texto puro", () => {
  const chat = ler(CHAT);

  assert.match(chat, /<AgentMarkdown>\{m\.texto\}<\/AgentMarkdown>/);

  // E o caminho antigo não sobreviveu ao lado. A bolha da PESSOA continua com
  // `whitespace-pre-wrap`, e é correto: o que ela escreveu não é Markdown. Por
  // isso a asserção é sobre a ausência do par `m.texto` + pré-formatado na
  // mesma expressão, e não sobre a classe em qualquer lugar do arquivo.
  assert.doesNotMatch(
    chat,
    /whitespace-pre-wrap[^>]*>\s*\{m\.texto\}\s*<\/p>\s*\)\s*:\s*m\.passos/,
    "a resposta do agente voltou a sair como texto pré-formatado",
  );
});

test("o dialeto é o que o agente escreve: tabela e quebra de linha simples", () => {
  const md = ler(MARKDOWN);
  // `remark-gfm` traz tabela, tachado e lista de tarefa; `remark-breaks` faz a
  // quebra de linha simples virar `<br>`. Sem o segundo, duas frases que o
  // agente separou chegam coladas.
  assert.match(md, /remarkPlugins=\{\[remarkGfm, remarkBreaks\]\}/);
});

test("código inline não é coral; o link é", () => {
  const md = ler(MARKDOWN);

  const codigo = mapeamentoDe(md, "code");
  assert.doesNotMatch(
    codigo,
    /text-primary/,
    "o código inline voltou a ser coral — o acento é para uma coisa por vez",
  );
  // O que distingue código de texto é véu e forma, e a cor é herdada.
  assert.match(codigo, /text-inherit/);
  assert.match(codigo, /bg-surface-interactive/);
  // A monoespaçada chega pela constante, e é ela que carrega o valor. Conferir
  // as duas pontas: sem a segunda asserção, renomear a constante para outra
  // fonte passaria batido.
  assert.match(codigo, /\bMONO\b/);
  assert.match(md, /const MONO = "font-mono"/);

  const link = mapeamentoDe(md, "a");
  assert.match(link, /text-primary/, "o link perdeu o coral");
});

test("o bloco de código desfaz o véu do inline", () => {
  // A superfície é do bloco, não de cada pedaço dele. Sem isto sai véu sobre
  // véu e respiro no meio da linha.
  const pre = mapeamentoDe(ler(MARKDOWN), "pre");
  assert.match(pre, /\[&_code\]:bg-transparent/);
  assert.match(pre, /\[&_code\]:p-0/);
});

test("o Markdown não traz o plugin de tipografia para dentro de cada App", () => {
  const pkg = JSON.parse(ler("package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  assert.ok(deps["react-markdown"], "o react-markdown saiu das dependências");
  assert.ok(deps["remark-gfm"], "o remark-gfm saiu das dependências");
  assert.ok(deps["remark-breaks"], "o remark-breaks saiu das dependências");

  // A decisão: cada elemento é mapeado à mão em vez de usar os variantes
  // `prose-*`, que exigiriam o plugin em todo App criado a partir daqui.
  assert.ok(
    !deps["@tailwindcss/typography"],
    "o plugin de tipografia entrou — o mapeamento à mão existe para evitá-lo",
  );
  // Sem comentários: este arquivo EXPLICA por que não usa os variantes
  // `prose-*`, e a explicação casaria com a própria varredura. Medido — o caso
  // falhava contra o texto do comentário, não contra o código.
  assert.doesNotMatch(
    semComentarios(ler(MARKDOWN)),
    /\bprose-/,
    "o componente passou a depender dos variantes prose-*",
  );
});

// ---------------------------------------------------------------------------
// A chamada de ferramenta
// ---------------------------------------------------------------------------

test("o que a ferramenta recebeu e devolveu é RETIDO, não descartado", () => {
  const chat = ler(CHAT);

  // O defeito que isto guarda: os eventos traziam `input` e `output`, e o chat
  // guardava só nome e estado. O bloco que expande não teria o que mostrar.
  assert.match(
    chat,
    /entrada: evento\.input/,
    "a entrada da ferramenta voltou a ser descartada",
  );
  assert.match(
    chat,
    /saida: evento\.output/,
    "a saída da ferramenta voltou a ser descartada",
  );
});

test("o resultado SUBSTITUI o passo em vez de mutá-lo no lugar", () => {
  // O bloco é um componente com estado próprio. Mutar o objeto que ele já
  // recebeu deixaria o React sem sinal de que o conteúdo mudou, e o detalhe
  // ficaria vazio depois de aberto.
  const chat = ler(CHAT);
  const trecho = chat.slice(chat.indexOf('case "tool_result"'));
  assert.match(trecho.slice(0, 700), /m\.passos = m\.passos\.map\(/);
});

test("o bloco mostra o nome legível fora e o cru dentro", () => {
  const bloco = ler(BLOCO);
  // `listar_recados` vira "listar recados" na pílula — o `DESIGN.md` proíbe
  // jargão na interface. O nome cru fica no detalhe, onde ele é a informação
  // certa para quem foi olhar.
  assert.match(bloco, /function nomeLegivel/);
  assert.match(bloco, /replace\(\/\[_\.\]\+\/g, " "\)/);
  assert.match(bloco, /\{chamada\.nome\}/, "o nome cru não aparece no detalhe");
});

test("sem detalhe, o botão não finge ser clicável", () => {
  const bloco = ler(BLOCO);
  // Enquanto a ferramenta roda não há saída, e um botão que não faz nada é pior
  // que um rótulo.
  assert.match(bloco, /disabled=\{!temDetalhe\}/);
});

// ---------------------------------------------------------------------------
// O anexo, até o SDK
// ---------------------------------------------------------------------------

test("os anexos chegam ao SDK na conversa nova E na continuação", () => {
  const rota = ler(ROTA);

  // Um só espalhamento, usado nos dois caminhos: passar `files` em `run` e
  // esquecer em `continue` faria o anexo funcionar na primeira mensagem e sumir
  // na segunda — o pior tipo de defeito, porque parece funcionar.
  assert.match(rota, /const comAnexos = files\.length > 0 \? \{ files \} : \{\}/);

  // A janela de cada chamada vai até onde a OUTRA começa, e não a um número de
  // caracteres. Medido: com um `slice(0, 300)` a partir do `continue`, tirar o
  // espalhamento de lá deixava o caso VERDE — a janela alcançava o bloco do
  // `run`, que ainda tinha o seu, e a asserção lia o vizinho.
  const iContinue = rota.indexOf("volund.agents.continue");
  const iRun = rota.indexOf("volund.agents.run");
  assert.ok(iContinue > 0 && iRun > iContinue, "as duas chamadas mudaram de lugar");

  const continuacao = rota.slice(iContinue, iRun);
  assert.match(continuacao, /\.\.\.comAnexos/, "continue não leva os anexos");

  const novo = rota.slice(iRun);
  assert.match(novo, /\.\.\.comAnexos/, "run não leva os anexos");
});

test("o teto do envio é conferido no SERVIDOR, sobre o conteúdo que chegou", () => {
  const rota = ler(ROTA);

  // A validação da tela é conveniência: esta rota atende qualquer cliente que
  // saiba o endereço. E o peso é medido no base64 recebido, não no número que o
  // cliente afirmou.
  assert.match(rota, /function bytesDoBase64/);
  assert.match(rota, /pesoInline > LIMITE_TOTAL_BYTES/);
  assert.match(rota, /status: 413/);
  assert.match(rota, /files: z\.array\(anexo\)\.max\(LIMITE_DE_ARQUIVOS\)/);
});

test("a conta do base64 desconta o preenchimento", () => {
  // Sem descontar os `=`, o peso medido fica maior que o real e um envio no
  // limite seria recusado por engano.
  const rota = ler(ROTA);
  const fn = rota.slice(rota.indexOf("function bytesDoBase64"));
  assert.match(fn.slice(0, 500), /endsWith\("=="\)/);
});

test("o chat envia os anexos junto da mensagem", () => {
  const chat = ler(CHAT);
  assert.match(chat, /files\.length > 0 \? \{ files \} : \{\}/);
  // Congelados ANTES do `await`: a lista da tela é limpa no mesmo turno, e ler
  // o estado depois da leitura dos arquivos pegaria a lista já vazia.
  assert.match(chat, /const paraEnviar = anexos;/);
});

// ---------------------------------------------------------------------------
// Os quatro reparos da revisão
// ---------------------------------------------------------------------------

test("a união de anexo é exclusiva DE VERDADE, e não só na intenção", () => {
  // `z.object` descarta chave desconhecida em silêncio: um item com `url` e
  // `data` casava com o primeiro membro, o `data` sumia, e a rota encaminhava
  // só a URL — sem o conteúdo entrar na conta do peso. O comentário no arquivo
  // já prometia recusa; o código é que não cumpria. Apontado na revisão.
  const rota = ler(ROTA);
  const uniao = rota.slice(rota.indexOf("const anexo = z.union"));
  const corpo = uniao.slice(0, uniao.indexOf("]);"));

  assert.doesNotMatch(
    corpo,
    /z\.object\(/,
    "voltou a usar z.object, que descarta chave desconhecida em silêncio",
  );
  // Os DOIS membros: um só estrito deixaria o outro lado da união permissivo.
  assert.equal(
    (corpo.match(/z\.strictObject\(/g) ?? []).length,
    2,
    "os dois membros da união precisam ser estritos",
  );
});

test("as regiões que rolam recebem foco pelo teclado", () => {
  // Um `overflow-x-auto` não é focável por si. Quando a tabela ou o bloco de
  // código passam da largura da bolha, quem navega sem mouse não alcança o
  // resto. Apontado na revisão.
  const md = ler(MARKDOWN);

  for (const [elemento, rotulo] of [
    ["pre", "Bloco de código"],
    ["table", "Tabela"],
  ] as const) {
    const trecho = mapeamentoDe(md, elemento);
    assert.match(trecho, /overflow-x-auto/, `${elemento} deixou de rolar`);
    assert.match(trecho, /tabIndex=\{0\}/, `${elemento} não recebe foco`);
    assert.match(
      trecho,
      new RegExp(`aria-label="${rotulo}"`),
      `${elemento} sem rótulo`,
    );
  }
});

test("a confirmação de cópia cancela o prazo anterior", () => {
  // Dois cliques dentro de 1,6 s deixavam o primeiro temporizador apagar a
  // confirmação do segundo. Apontado na revisão.
  const bloco = ler(BLOCO);
  const botao = bloco.slice(bloco.indexOf("function BotaoCopiar"));

  // A janela vai de `setCopiado(true)` até a criação do prazo novo. Medido: uma
  // janela mais larga passava VERDE com o cancelamento removido do clique,
  // porque o `clearTimeout` da limpeza do `useEffect` está no mesmo componente
  // e a asserção lia o vizinho. O que importa é o cancelamento estar ENTRE a
  // confirmação e o prazo seguinte.
  const iConfirma = botao.indexOf("setCopiado(true)");
  const iNovoPrazo = botao.indexOf("prazo.current = setTimeout");
  assert.ok(
    iConfirma > 0 && iNovoPrazo > iConfirma,
    "o corpo do clique mudou de forma",
  );
  assert.match(
    botao.slice(iConfirma, iNovoPrazo),
    /clearTimeout\(prazo\.current\)/,
    "o prazo anterior não é cancelado antes de o próximo nascer",
  );

  // E a limpeza na desmontagem, que evita `setState` em componente fora da tela
  // quando o bloco é fechado antes de o prazo vencer. Ela vive no `useEffect`,
  // ANTES do corpo do clique.
  assert.match(
    botao.slice(0, iConfirma),
    /useEffect\([\s\S]*clearTimeout\(prazo\.current\)/,
    "sumiu a limpeza na desmontagem",
  );
});

test("anexo ilegível não é reportado como queda de conexão", () => {
  const chat = ler(CHAT);
  const captura = chat.slice(chat.indexOf("} catch (err) {"));
  const janela = captura.slice(0, 900);

  // A checagem específica tem de vir ANTES da frase genérica; depois dela o
  // `return` nunca seria alcançado e a pessoa leria a causa errada.
  const iEspecifico = janela.indexOf("AnexoIlegivelError");
  const iGenerico = janela.indexOf("A conexão caiu no meio da resposta");
  assert.ok(iEspecifico > 0, "o chat não distingue anexo ilegível");
  assert.ok(
    iEspecifico < iGenerico,
    "a frase genérica vem antes e engole o caso do anexo",
  );
});

test("envio que falha devolve os anexos, e o cancelamento não", () => {
  // A lista é limpa antes do `fetch` para a tela responder na hora. Se a
  // requisição falha, o aviso diz "tente enviar de novo" — e sem devolver, os
  // arquivos já não estão lá. Só o `File` em `paraEnviar` referencia o
  // conteúdo, então não há como recuperá-los senão escolhendo tudo de novo.
  // Apontado na revisão, como nitpick no corpo.
  const chat = ler(CHAT);
  assert.match(chat, /const devolverAnexos = \(\) => \{/);

  const captura = chat.slice(chat.indexOf("} catch (err) {"));
  const janela = captura.slice(0, 1200);

  // Cancelar é pedido nosso — a pessoa mandou outra mensagem por cima ou saiu
  // da tela. Devolver ali plantaria os arquivos da mensagem velha no envio
  // novo, então a devolução tem de vir DEPOIS da checagem de AbortError.
  const iAbort = janela.indexOf("AbortError");
  const iDevolve = janela.indexOf("devolverAnexos()");
  assert.ok(iAbort > 0 && iDevolve > iAbort, "o cancelamento devolveria os anexos");

  // E o caminho da resposta ruim (o 413 do teto, por exemplo) também devolve.
  const respostaRuim = chat.slice(chat.indexOf("if (!resposta.ok"));
  assert.match(
    respostaRuim.slice(0, 500),
    /devolverAnexos\(\)/,
    "resposta ruim perde os anexos",
  );
});

test("a rota impõe as DUAS regras de tamanho, não só a soma", () => {
  // `LIMITE_POR_ARQUIVO_BYTES` é 75% do total: um arquivo sozinho podia passar
  // do teto individual e ainda ficar abaixo da soma. Quem chamasse a rota
  // direto contornava a regra que a tela aplica — e metade das regras no
  // servidor não é validação de servidor. Apontado na revisão, fora do diff.
  const rota = ler(ROTA);
  const bloco = rota.slice(rota.indexOf("const files = parsed.data.files"));
  const janela = bloco.slice(0, bloco.indexOf("try {"));

  assert.match(
    janela,
    /peso > LIMITE_POR_ARQUIVO_BYTES/,
    "a rota não confere o teto por arquivo",
  );
  assert.match(
    janela,
    /pesoInline > LIMITE_TOTAL_BYTES/,
    "a rota não confere o teto do envio",
  );

  // A recusa por arquivo vem ANTES de somar: acumular primeiro e recusar depois
  // daria a frase da soma para um caso que é de arquivo único.
  const iPorArquivo = janela.indexOf("peso > LIMITE_POR_ARQUIVO_BYTES");
  const iSoma = janela.indexOf("pesoInline > LIMITE_TOTAL_BYTES");
  assert.ok(iPorArquivo < iSoma, "a soma decide antes da regra por arquivo");

  // E a frase nomeia o arquivo quando o nome veio — sem ele a pessoa não sabe
  // qual dos cinco remover.
  assert.match(janela, /f\.name \? /, "a recusa por arquivo não nomeia o arquivo");
});
