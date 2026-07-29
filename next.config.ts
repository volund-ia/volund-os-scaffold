import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O app roda em modo de desenvolvimento DENTRO do sandbox e é exibido ao
  // usuário num iframe servido pelo proxy do ambiente (`<porta>-<id>.e2b.app`).
  //
  // Sem isto o Next devolve **403 em todo `/_next/*`**: ele bloqueia por padrão
  // requisições cross-origin a recursos de desenvolvimento
  // (`server/lib/router-utils/block-cross-site-dev.ts`). O HTML até carrega, mas
  // nenhum chunk de JS e nenhum WebSocket de recarga automática passam — a tela
  // fica em branco sem erro visível para o usuário.
  //
  // Só afeta `next dev`; o build de produção ignora esta chave.
  allowedDevOrigins: ["*.e2b.app"],
};

export default nextConfig;
