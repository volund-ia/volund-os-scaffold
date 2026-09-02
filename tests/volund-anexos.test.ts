// Anexos na conversa com o agente: o que entra, o que é recusado, e por quê.
//
// O que estes casos protegem, em uma frase cada:
//
//  - O teto DERIVA do limite de corpo da hospedagem, e a conta é conferida em
//    base64. É o caso que importa: alguém que aumente o limite "porque 3 MB é
//    pouco" descobre aqui que o corpo passa de 4,5 MB, e não em produção, com a
//    requisição cortada antes de o código rodar.
//  - Cada recusa é medida com o cenário ARMADO — um arquivo grande de verdade,
//    uma lista já cheia, uma soma que estoura. Um caso que passasse um `File`
//    pequeno numa lista vazia mediria o próprio silêncio: nada recusa, e a
//    asserção "não recusou" passaria com a regra desligada.
//  - A soma conta o que já foi ACEITO nesta rodada, e não só o que estava na
//    tela. Sem isso, cinco arquivos escolhidos de uma vez passariam todos.
//  - O base64 de um arquivo grande não estoura a pilha. `fromCharCode` com o
//    array inteiro lança `RangeError` acima de ~100 KB, e o sintoma seria um
//    envio que falha só com anexo grande.
//
// Rodar: npm test
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ACEITA,
  AnexoIlegivelError,
  LIMITE_DE_ARQUIVOS,
  LIMITE_POR_ARQUIVO_BYTES,
  LIMITE_TOTAL_BYTES,
  TIPOS_ACEITOS,
  avaliarAnexo,
  paraBase64,
  prepararAnexos,
  tamanhoLegivel,
  type AnexoEscolhido,
} from "../lib/volund/attachments";

/** Teto do corpo da função serverless na Vercel — a fonte do limite. */
const TETO_DO_CORPO = 4.5 * 1024 * 1024;

/** Um arquivo de mentira com tamanho e tipo escolhidos. */
function arquivo(nome: string, bytes: number, mime = "image/png"): File {
  // `File` do Node 20+ existe global. O conteúdo é irrelevante para as regras
  // de tamanho; o que importa é `size`, e ele vem do buffer.
  return new File([new Uint8Array(bytes)], nome, { type: mime });
}

/** Um anexo já aceito, para compor a lista dos casos que dependem dela. */
function jaAceito(nome: string, bytes: number): AnexoEscolhido {
  return {
    id: `id-${nome}`,
    nome,
    tamanho: bytes,
    mime: "image/png",
    arquivo: arquivo(nome, 1),
  };
}

// ---------------------------------------------------------------------------
// O teto, e de onde ele vem
// ---------------------------------------------------------------------------

test("o envio inteiro, já em base64, cabe no corpo que a hospedagem aceita", () => {
  // A conta que justifica o número. Base64 infla 4/3, e é o texto inflado que
  // viaja — conferir o limite CRU contra o teto do corpo seria conferir a
  // grandeza errada e deixar passar um envio 33% acima.
  const corpoInflado = LIMITE_TOTAL_BYTES * (4 / 3);
  assert.ok(
    corpoInflado < TETO_DO_CORPO,
    `o envio no limite dá ${tamanhoLegivel(corpoInflado)} de corpo, e o teto é ${tamanhoLegivel(TETO_DO_CORPO)}`,
  );

  // E sobra margem para o resto do corpo: o texto da mensagem (até 20.000
  // caracteres), o identificador da conversa e os nomes dos arquivos.
  assert.ok(
    TETO_DO_CORPO - corpoInflado > 20_000,
    "não sobra espaço para o texto da mensagem ao lado dos anexos",
  );
});

test("um arquivo sozinho não ocupa o envio inteiro", () => {
  // Se o teto por arquivo fosse igual ao total, o primeiro anexo no limite
  // deixaria o segundo sem espaço — e a pessoa só descobriria na segunda
  // escolha, sem entender por quê.
  assert.ok(
    LIMITE_POR_ARQUIVO_BYTES < LIMITE_TOTAL_BYTES,
    "o teto por arquivo tem de ser menor que o do envio",
  );
});

test("o accept do seletor lista os tipos, e não um curinga", () => {
  // O `accept` é a primeira conversa com a pessoa: oferecer tudo para recusar
  // depois é pior do que oferecer o que funciona.
  assert.ok(TIPOS_ACEITOS.length > 0);
  assert.doesNotMatch(ACEITA, /\*/, "o accept virou curinga");
  for (const tipo of TIPOS_ACEITOS) {
    assert.ok(ACEITA.includes(tipo), `${tipo} ficou fora do accept`);
  }
});

// ---------------------------------------------------------------------------
// As recusas, cada uma com o cenário armado
// ---------------------------------------------------------------------------

test("um arquivo dentro das regras entra", () => {
  const veredito = avaliarAnexo(arquivo("planta.png", 1024), []);
  assert.equal(veredito.ok, true);
  if (veredito.ok) {
    assert.equal(veredito.valor.nome, "planta.png");
    assert.equal(veredito.valor.tamanho, 1024);
    assert.equal(veredito.valor.mime, "image/png");
  }
});

test("acima do teto por arquivo é recusado, e a frase diz os dois números", () => {
  const grande = arquivo("mapa.png", LIMITE_POR_ARQUIVO_BYTES + 1);
  const veredito = avaliarAnexo(grande, []);
  assert.equal(veredito.ok, false);
  if (!veredito.ok) {
    assert.match(veredito.motivo, /mapa\.png/);
    // O tamanho do arquivo E o limite: "grande demais" sem número não diz à
    // pessoa o que ela precisa fazer.
    assert.match(veredito.motivo, /limite por arquivo/i);
    assert.match(veredito.motivo, /MB/);
  }
});

test("a soma dos anexos é conferida contra o teto do envio", () => {
  // Armado: dois anexos que passam sozinhos e estouram juntos. Sem o primeiro
  // já na lista, o segundo entraria e o caso mediria o próprio silêncio.
  const metade = Math.floor(LIMITE_TOTAL_BYTES * 0.6);
  const veredito = avaliarAnexo(arquivo("b.png", metade), [jaAceito("a.png", metade)]);
  assert.equal(veredito.ok, false);
  if (!veredito.ok) assert.match(veredito.motivo, /Somados/);
});

test("acima da quantidade é recusado", () => {
  const cheia = Array.from({ length: LIMITE_DE_ARQUIVOS }, (_, i) =>
    jaAceito(`a${i}.png`, 10),
  );
  const veredito = avaliarAnexo(arquivo("extra.png", 10), cheia);
  assert.equal(veredito.ok, false);
  if (!veredito.ok) assert.match(veredito.motivo, new RegExp(`${LIMITE_DE_ARQUIVOS}`));
});

test("arquivo vazio é recusado antes de a plataforma reclamar do formato", () => {
  // Sem bytes não há magic bytes: a plataforma recusaria por tipo, e a pessoa
  // leria um erro de formato sobre um arquivo que só está vazio.
  const veredito = avaliarAnexo(arquivo("nada.png", 0), []);
  assert.equal(veredito.ok, false);
  if (!veredito.ok) assert.match(veredito.motivo, /vazio/);
});

test("tipo fora da lista é recusado, mas tipo AUSENTE passa", () => {
  const fora = avaliarAnexo(
    arquivo("planilha.xlsx", 100, "application/vnd.ms-excel"),
    [],
  );
  assert.equal(fora.ok, false);

  // O navegador manda `type` vazio para extensão que ele não conhece. Recusar
  // por falta de metadado barraria arquivo bom — quem decide de verdade é o
  // sniff da plataforma.
  const semTipo = avaliarAnexo(arquivo("leiame", 100, ""), []);
  assert.equal(semTipo.ok, true);
});

test("o mesmo arquivo escolhido duas vezes não entra duas vezes", () => {
  const veredito = avaliarAnexo(arquivo("foto.png", 2048), [
    jaAceito("foto.png", 2048),
  ]);
  assert.equal(veredito.ok, false);
  if (!veredito.ok) assert.match(veredito.motivo, /já está anexado/);
});

test("mesmo nome e tamanho DIFERENTE são arquivos diferentes", () => {
  // A repetição é por nome E tamanho. Só por nome, uma versão nova do mesmo
  // arquivo seria recusada — e é justamente o que a pessoa quer anexar.
  const veredito = avaliarAnexo(arquivo("foto.png", 4096), [
    jaAceito("foto.png", 2048),
  ]);
  assert.equal(veredito.ok, true);
});

// ---------------------------------------------------------------------------
// A conversão
// ---------------------------------------------------------------------------

test("o base64 de um arquivo grande não estoura a pilha", async () => {
  // 600 KB: bem acima do ponto em que `String.fromCharCode(...bytes)` com o
  // array inteiro lança `RangeError`. O caso existe para provar o fatiamento;
  // sem ele o envio falharia só com anexo grande, que é o pior jeito de
  // descobrir.
  const bytes = new Uint8Array(600 * 1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;

  const base64 = paraBase64(bytes.buffer);

  // Ida e volta: o tamanho certo não prova que o conteúdo sobreviveu ao
  // fatiamento — um pedaço perdido daria o mesmo comprimento com bytes errados.
  const devolta = Buffer.from(base64, "base64");
  assert.equal(devolta.length, bytes.length);
  assert.ok(devolta.equals(Buffer.from(bytes)), "o conteúdo mudou na conversão");
});

test("preparar os anexos devolve o que o SDK aceita", async () => {
  const conteudo = new Uint8Array([1, 2, 3, 4, 5]);
  const escolhido: AnexoEscolhido = {
    id: "x",
    nome: "recibo.pdf",
    tamanho: conteudo.length,
    mime: "application/pdf",
    arquivo: new File([conteudo], "recibo.pdf", { type: "application/pdf" }),
  };

  const prontos = await prepararAnexos([escolhido]);
  // Um anexo entrou, um tem de sair: sem esta asserção o `pronto` abaixo
  // poderia ser `undefined` e o caso passaria por não ter o que conferir.
  assert.equal(prontos.length, 1);
  const pronto = prontos[0]!;

  // As três chaves do modo `data` de `VolundFileInput`, e nada além.
  assert.deepEqual(Object.keys(pronto).sort(), ["data", "mime", "name"]);
  assert.equal(pronto.name, "recibo.pdf");
  assert.equal(pronto.mime, "application/pdf");
  assert.ok(Buffer.from(pronto.data, "base64").equals(Buffer.from(conteudo)));
});

test("tamanho legível fala português, não bytes crus", () => {
  assert.equal(tamanhoLegivel(512), "512 B");
  assert.equal(tamanhoLegivel(2048), "2 KB");
  // Vírgula, não ponto: o número aparece numa frase em português.
  assert.match(tamanhoLegivel(1024 * 1024 * 2.5), /2,5 MB/);
});

// ---------------------------------------------------------------------------
// Leitura que falha depois da escolha
// ---------------------------------------------------------------------------

test("arquivo ilegível dá um erro PRÓPRIO, com o nome, e não queda de conexão", async () => {
  // `arrayBuffer()` pode rejeitar depois da escolha — o caso comum é o arquivo
  // ser movido ou apagado entre escolher e enviar. Sem um erro próprio, a
  // rejeição caía no `catch` genérico do envio e a pessoa lia "a conexão caiu",
  // que aponta a causa errada e a faz tentar de novo o mesmo arquivo.
  const quebrado = {
    name: "sumiu.png",
    type: "image/png",
    size: 10,
    arrayBuffer: () => Promise.reject(new Error("NotReadableError")),
  } as unknown as File;

  const escolhido: AnexoEscolhido = {
    id: "z",
    nome: "sumiu.png",
    tamanho: 10,
    mime: "image/png",
    arquivo: quebrado,
  };

  await assert.rejects(
    () => prepararAnexos([escolhido]),
    (err: unknown) => {
      assert.ok(err instanceof AnexoIlegivelError, "veio um erro genérico");
      // O NOME no erro: "não consegui ler um dos anexos" obrigaria a pessoa a
      // descobrir qual, removendo um por um.
      assert.equal(err.nome, "sumiu.png");
      assert.match(err.message, /sumiu\.png/);
      return true;
    },
  );
});

test("um anexo ilegível no meio não é confundido com os que leem bem", async () => {
  // Armado com um bom ANTES do quebrado: se a implementação parasse no primeiro
  // erro sem nomear, o caso não distinguiria qual falhou.
  const bom: AnexoEscolhido = {
    id: "a",
    nome: "ok.png",
    tamanho: 3,
    mime: "image/png",
    arquivo: new File([new Uint8Array([1, 2, 3])], "ok.png", { type: "image/png" }),
  };
  const ruim: AnexoEscolhido = {
    id: "b",
    nome: "quebrado.pdf",
    tamanho: 4,
    mime: "application/pdf",
    arquivo: {
      arrayBuffer: () => Promise.reject(new Error("NotReadableError")),
    } as unknown as File,
  };

  await assert.rejects(
    () => prepararAnexos([bom, ruim]),
    (err: unknown) => err instanceof AnexoIlegivelError && err.nome === "quebrado.pdf",
  );
});
