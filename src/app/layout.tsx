import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import { fetchEnvironmentSnapshot } from "@/lib/workspaces/api";

export const metadata: Metadata = {
  title: "Forge",
  description: "Forge development environment",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialEnvironment = await fetchEnvironmentSnapshot().catch(() => undefined);

  return (
    <html lang="en">
      <body className="antialiased">
         <Providers initialEnvironment={initialEnvironment}>

        {children}
         </Providers>
      </body>
    </html>
  );
}
