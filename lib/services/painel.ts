import { z } from "zod";

import { defineService } from "./define";
import { ok } from "./types";

/**
 * Serviços de EXEMPLO — o padrão que todo serviço novo deve seguir.
 *
 * Existe porque o exemplo é o que acaba copiado. São dois, de propósito, porque
 * são os dois casos que existem:
 *
 * - `ver_perfil` **não exige permissão** — e por isso o nome está declarado em
 *   `lib/services/policy.ts`, com o motivo ao lado;
 * - `ver_diagnostico` **exige** a permissão `ver_diagnostico`, e enquanto
 *   ninguém a conceder na aba Segurança do App ele recusa todo mundo. Esse é o
 *   estado correto, não uma pendência: nenhum acesso nasce implícito.
 *
 * Repare no que NÃO há aqui: nenhuma resposta HTTP, nenhum status, nenhum
 * cabeçalho, nenhum cookie. O serviço decide; traduzir para a porta é trabalho de
 * quem chama. É isso que permite a mesma decisão valer para a tela, para a rota e
 * para a tool de MCP.
 *
 * Substitua ou apague quando a aplicação tiver regra de negócio de verdade.
 */

/** Nenhuma entrada. `z.object({})` e não `z.undefined()`: quem chama passa `{}`. */
const semEntrada = z.object({});

export interface Perfil {
  nome: string | null;
  email: string | null;
  papeis: string[];
  permissoes: string[];
}

export const verPerfil = defineService({
  name: "ver_perfil",
  summary: "Mostra os dados da sessão de quem está chamando.",
  kind: "read",
  // Sem permissão, e isto é uma declaração: quem tem sessão já é o dono do que
  // este serviço devolve. Nome declarado em PUBLIC_SERVICES.
  permission: null,
  input: semEntrada,
  run: (session) =>
    ok<Perfil>({
      nome: session.name,
      email: session.email,
      papeis: session.roles,
      permissoes: session.permissions,
    }),
});

export interface Diagnostico {
  appId: string;
  orgId: string;
  /** O banco está configurado? **Só isto** — ver o comentário abaixo. */
  bancoConfigurado: boolean;
  consultadoEm: string;
}

export const verDiagnostico = defineService({
  name: "ver_diagnostico",
  summary: "Mostra os detalhes técnicos da instalação deste App.",
  kind: "read",
  // Leitura protegida. É o caso mais comum num App real — quase nada é para
  // qualquer um que tenha sessão —, e é o caso que se esquece de cobrir quando se
  // pensa em permissão como coisa de escrita.
  permission: "ver_diagnostico",
  input: semEntrada,
  run: (session) =>
    ok<Diagnostico>({
      appId: session.appId,
      orgId: session.orgId,
      // A pergunta é "está configurado?", e a resposta é um booleano. Devolver a
      // `DATABASE_URL` entregaria host, porta, usuário e senha do banco a quem
      // chamar o serviço — e serviço é alcançável por API e por MCP, não só pela
      // tela de quem administra.
      bancoConfigurado: Boolean(process.env.DATABASE_URL),
      consultadoEm: new Date().toISOString(),
    }),
});
