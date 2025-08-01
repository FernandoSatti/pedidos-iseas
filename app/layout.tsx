import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Iseas - Gestión de Pedidos",
  description: "Sistema completo de gestión de pedidos con trazabilidad",
  icons: {
    icon: [
      { url: "/alfonsa32x32.png", sizes: "32x32", type: "image/png" },
      "/alfonsa32x32.png", // fallback
    ],
    apple: "/alfonsa32x32.png",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body className={inter.className}>{children}</body>
      <link rel="icon" type="image/png" sizes="32x32" href="/alfonsa32x32.png" />
        <link rel="apple-touch-icon" href="/alfonsa32x32.png" />
    </html>
  )
}
