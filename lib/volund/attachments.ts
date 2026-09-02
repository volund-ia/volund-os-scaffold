/**
 * Anexos de uma mensagem para o agente.
 *
 * ## O caminho que o arquivo faz
 *
 * Navegador → esta aplicação → plataforma. O SDK aceita cada anexo de duas
 * formas (`VolundFileInput`): `{ url }`, que a plataforma BAIXA, ou `{ data }`,
 * o conteúdo em base64. Um App recém-criado não tem onde hospedar arquivo — ele
 * nasce com Postgres e nada mais —, então o modo daqui é `data`.
 *
 * A plataforma revalida tudo do outro lado: cheira o MIME por magic bytes,
 * confere tamanho por tipo e re-hospeda o blob (ver
 * `lib/agent/connectors/api/files.ts` no VolundOS). O que este arquivo faz não é
 * a segurança — é recusar cedo, com uma frase que a pessoa entende, o que a
 * plataforma recusaria depois com um erro que ela não entenderia.
 *
 * ## De onde vem o teto, e por que ele não é 100 MB
 *
 * A plataforma aceita até 100 MB por arquivo. Este App não: o anexo viaja no
 * CORPO de uma função serverless, e esse corpo tem teto próprio (4,5 MB na
 * Vercel). Base64 infla o conteúdo em 4/3, então o limite útil de arquivo é
 * menor que o limite de corpo — e é dessa conta que sai o número, não de um
 * palpite redondo.
 *
 * Estourar esse teto não dá erro bonito: a plataforma de hospedagem corta a
 * requisição antes de o código rodar, e a pessoa vê a mensagem genérica dela.
 * Por isso a recusa aqui é ANTES do envio, e a soma do envio inteiro conta —
 * três arquivos de 2 MB passam individualmente e derrubam o corpo junto.
 *
 * Para ir além disso, um App precisa de um lugar público onde hospedar o
 * arquivo e passar a usar `{ url }`. É trabalho de quem constrói o App, não do
 * scaffold, e está anotado no `AGENTS.md`.
 */

/** Teto do corpo da função serverless na plataforma de hospedagem. */
const TETO_DO_CORPO = 4.5 * 1024 * 1024;

/**
 * Reserva para o resto do corpo: o texto da mensagem (até 20.000 chars), o
 * identificador da conversa, os nomes dos arquivos e o embrulho JSON.
 */
const RESERVA = 96 * 1024;

/** Fator de inflação do base64: cada 3 bytes viram 4 caracteres. */
const INFLACAO_BASE64 = 4 / 3;

/**
 * Quanto de arquivo CRU cabe num envio, somando todos os anexos.
 *
 * Deriva do teto do corpo, e não o contrário: mudar a hospedagem muda o teto, e
 * o número aqui acompanha sozinho.
 */
export const LIMITE_TOTAL_BYTES = Math.floor(
  (TETO_DO_CORPO - RESERVA) / INFLACAO_BASE64,
);

/**
 * Teto por arquivo. Menor que o total de propósito: com um arquivo só no limite
 * do envio não sobra espaço para um segundo, e a pessoa descobriria isso na
 * segunda tentativa.
 */
export const LIMITE_POR_ARQUIVO_BYTES = Math.floor(LIMITE_TOTAL_BYTES * 0.75);

/** Quantos anexos por mensagem. */
export const LIMITE_DE_ARQUIVOS = 5;

/**
 * O que a plataforma entende como conteúdo multimodal nativo, mais os formatos
 * de texto que ela anota junto da mensagem.
 *
 * Lista explícita, e não um curinga que aceite qualquer coisa: o `accept` do
 * seletor de arquivo é a primeira conversa com a pessoa, e oferecer tudo para
 * recusar depois é pior do que oferecer o que funciona.
 */
export const TIPOS_ACEITOS = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
] as const;

/** Para o atributo `accept` do `<input type="file">`. */
export const ACEITA = TIPOS_ACEITOS.join(",");

/** Um anexo no formato que o SDK aceita (`VolundFileInput`, modo `data`). */
export interface AnexoParaEnvio {
  data: string;
  name: string;
  mime: string;
}

/** Um anexo escolhido, ainda no navegador. */
export interface AnexoEscolhido {
  id: string;
  nome: string;
  tamanho: number;
  mime: string;
  arquivo: File;
}

export type Recusa = { ok: false; motivo: string };
export type Aceite<T> = { ok: true; valor: T };
export type Resultado<T> = Aceite<T> | Recusa;

/** Bytes em algo que se lê numa frase: "2,3 MB". */
export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/**
 * Decide se um arquivo novo entra na lista.
 *
 * Recebe os que já estão escolhidos porque três das quatro recusas dependem
 * deles — quantidade, soma e repetição. Uma função que só olhasse o arquivo
 * novo aceitaria o quinto anexo e o mesmo arquivo duas vezes.
 */
export function avaliarAnexo(
  arquivo: File,
  jaEscolhidos: readonly AnexoEscolhido[],
): Resultado<AnexoEscolhido> {
  if (jaEscolhidos.length >= LIMITE_DE_ARQUIVOS) {
    return {
      ok: false,
      motivo: `Dá para anexar até ${LIMITE_DE_ARQUIVOS} arquivos por mensagem.`,
    };
  }

  // Vazio não é "pequeno": a plataforma não consegue cheirar o tipo de um blob
  // sem bytes, e a recusa dela chegaria como erro de formato.
  if (arquivo.size === 0) {
    return { ok: false, motivo: `“${arquivo.name}” está vazio.` };
  }

  if (arquivo.size > LIMITE_POR_ARQUIVO_BYTES) {
    return {
      ok: false,
      motivo: `“${arquivo.name}” tem ${tamanhoLegivel(arquivo.size)} e o limite por arquivo é ${tamanhoLegivel(LIMITE_POR_ARQUIVO_BYTES)}.`,
    };
  }

  // O tipo vem do navegador e pode chegar vazio (arquivo sem extensão
  // conhecida). Vazio passa: quem decide de verdade é o sniff da plataforma, e
  // recusar aqui por falta de metadado barraria arquivo bom.
  if (arquivo.type && !TIPOS_ACEITOS.includes(arquivo.type as never)) {
    return {
      ok: false,
      motivo: `“${arquivo.name}” é de um tipo que o assistente não lê.`,
    };
  }

  const somaAtual = jaEscolhidos.reduce((total, a) => total + a.tamanho, 0);
  if (somaAtual + arquivo.size > LIMITE_TOTAL_BYTES) {
    return {
      ok: false,
      motivo: `Somados, os anexos passam de ${tamanhoLegivel(LIMITE_TOTAL_BYTES)}. Envie em duas mensagens.`,
    };
  }

  // Mesmo nome E mesmo tamanho: é o mesmo arquivo escolhido duas vezes, o que
  // acontece sozinho quando a pessoa abre o seletor de novo e não lembra.
  const repetido = jaEscolhidos.some(
    (a) => a.nome === arquivo.name && a.tamanho === arquivo.size,
  );
  if (repetido) {
    return { ok: false, motivo: `“${arquivo.name}” já está anexado.` };
  }

  return {
    ok: true,
    valor: {
      // `crypto.randomUUID` existe no navegador e no Node moderno; o id é só
      // para a chave de lista e para remover, nunca sai daqui.
      id: crypto.randomUUID(),
      nome: arquivo.name,
      tamanho: arquivo.size,
      mime: arquivo.type || "application/octet-stream",
      arquivo,
    },
  };
}

/**
 * Base64 de um `ArrayBuffer`, sem estourar a pilha.
 *
 * `String.fromCharCode(...bytes)` com o array inteiro passa cada byte como
 * argumento — um arquivo de 3 MB são 3 milhões de argumentos, e o navegador
 * lança `RangeError`. Em pedaços de 32 KB isso não acontece, e a conta continua
 * a mesma.
 */
export function paraBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const PEDACO = 32 * 1024;
  let bruto = "";
  for (let i = 0; i < bytes.length; i += PEDACO) {
    bruto += String.fromCharCode(...bytes.subarray(i, i + PEDACO));
  }
  return btoa(bruto);
}

/**
 * Não deu para ler um arquivo escolhido.
 *
 * Existe para separar esta falha da queda de conexão. `arrayBuffer()` pode
 * rejeitar DEPOIS da escolha — o caso comum é o arquivo ser movido ou apagado
 * do disco entre escolher e enviar, o que produz `NotReadableError`. Sem um
 * erro próprio, a rejeição chegava ao `catch` genérico do envio e a pessoa lia
 * "a conexão caiu no meio da resposta": causa errada, e ela tentaria de novo o
 * mesmo arquivo ilegível. Apontado na revisão.
 */
export class AnexoIlegivelError extends Error {
  readonly nome: string;
  constructor(nome: string) {
    super(`Não consegui ler “${nome}”. Ele pode ter sido movido ou apagado.`);
    this.name = "AnexoIlegivelError";
    this.nome = nome;
  }
}

/** Converte os anexos escolhidos no que o SDK aceita. */
export async function prepararAnexos(
  escolhidos: readonly AnexoEscolhido[],
): Promise<AnexoParaEnvio[]> {
  return Promise.all(
    escolhidos.map(async (a) => {
      let buffer: ArrayBuffer;
      try {
        buffer = await a.arquivo.arrayBuffer();
      } catch {
        // O nome vai junto: "não consegui ler um dos anexos" obrigaria a pessoa
        // a descobrir qual, removendo um por um.
        throw new AnexoIlegivelError(a.nome);
      }
      return { data: paraBase64(buffer), name: a.nome, mime: a.mime };
    }),
  );
}
