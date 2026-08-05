import { z } from "zod";

import { defineService } from "./define";
import { ok } from "./types";

/**
 * Serviço de EXEMPLO com entrada — o par do `painel.ts`, que não tem nenhuma.
 *
 * Ele existia antes **dentro** de `app/api/echo/route.ts`, e por isso a rota
 * decidia: montava a resposta, aplicava o default de `repetir`, conhecia a
 * regra. Era a única porta do scaffold com lógica própria, e um exemplo assim
 * ensina o contrário do que o resto ensina — o exemplo é o que acaba copiado.
 *
 * Agora a regra está aqui e a rota é um adaptador de quatro linhas. A mesma
 * chamada pela tool de MCP produz o mesmo resultado, porque é o mesmo código.
 *
 * Substitua ou apague quando a aplicação tiver regra de negócio de verdade.
 */

const entrada = z.object({
  mensagem: z
    .string()
    .min(1, "não pode ser vazia")
    .max(280, "máximo de 280 caracteres"),
  repetir: z.number().int().min(1).max(5).optional(),
});

export interface Eco {
  eco: string[];
  recebidoEm: string;
}

export const ecoar = defineService({
  name: "ecoar",
  summary: "Repete a mensagem recebida, para conferir o caminho de ponta a ponta.",
  kind: "read",
  // Sem permissão, e declarado em PUBLIC_SERVICES: repetir de volta o que a
  // própria pessoa mandou não expõe nada de ninguém. Sessão continua exigida.
  permission: null,
  input: entrada,
  run: (_session, input) =>
    ok<Eco>({
      eco: Array.from({ length: input.repetir ?? 1 }, () => input.mensagem),
      recebidoEm: new Date().toISOString(),
    }),
});
