import { z } from "zod";

import { parseJsonBody, validationResponse } from "@/lib/validation";

/**
 * Rota de API de EXEMPLO — o padrão que toda rota nova deve seguir.
 *
 * Existe porque o exemplo é o que acaba copiado. Sem uma rota que valide a
 * entrada, a primeira rota escrita no app vai ler `await request.json()` e
 * confiar no que vier.
 *
 * Substitua ou apague quando a aplicação tiver rotas de verdade.
 */
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  mensagem: z
    .string()
    .min(1, "não pode ser vazia")
    .max(280, "máximo de 280 caracteres"),
  repetir: z.number().int().min(1).max(5).optional(),
});

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, bodySchema);
  if (!parsed.ok) return validationResponse(parsed);

  const { mensagem, repetir = 1 } = parsed.data;
  return Response.json({
    eco: Array.from({ length: repetir }, () => mensagem),
    recebidoEm: new Date().toISOString(),
  });
}
