import type { Metadata } from "next";

import "./globals.css";

/**
 * DELIBERADAMENTE sem `next/font/google`.
 *
 * O `create-next-app` e o `shadcn init` importam a fonte Geist do Google, e isso
 * faz o `next build` BAIXAR os arquivos de fonte de fonts.gstatic.com a cada
 * build frio. Este scaffold existe justamente para tirar rede do caminho
 * crítico, então a fonte é a pilha do sistema — definida em `--font-sans`, no
 * `globals.css`, que é a variável que os componentes do shadcn consomem.
 *
 * Se a aplicação precisar de webfont, adicione `next/font` aqui no app gerado e
 * aponte `--font-sans` para a variável dela. É uma escolha do produto, não um
 * default nosso.
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
    <html lang="pt-BR" className="h-full font-sans antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
