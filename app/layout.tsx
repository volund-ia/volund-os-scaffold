import type { Metadata } from "next";
import "./globals.css";

/**
 * DELIBERADAMENTE sem `next/font/google`: o `create-next-app` default importa
 * as fontes Geist, e isso faz o `next build` BAIXAR os arquivos de fonte de
 * fonts.gstatic.com a cada build frio. O scaffold existe justamente para
 * eliminar rede do caminho crítico, então usamos a pilha de fontes do sistema.
 * Se o app precisar de webfont, adicione `next/font` no app gerado.
 */
export const metadata: Metadata = {
  title: "App",
  description: "Aplicação criada no VolundOS.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
