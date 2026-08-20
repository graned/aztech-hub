import type { Metadata } from "next"
import Script from "next/script"
import type { ReactNode } from "react"

import "./globals.css"

export const metadata: Metadata = {
  title: "OpenCode Workspace Manager",
  description: "A local foundation for managing OpenCode workspaces.",
}

type RootLayoutProps = Readonly<{
  children: ReactNode
}>

export default function RootLayout({ children }: RootLayoutProps) {
  const enableDevTools =
    process.env.NODE_ENV === "development" && process.env["NEXT_PUBLIC_DISABLE_REACT_DEVTOOLS"] !== "1"

  return (
    <html lang="en">
      <head>
        {enableDevTools ? (
          <>
            <Script
              src="//unpkg.com/react-grab/dist/index.global.js"
              crossOrigin="anonymous"
              strategy="beforeInteractive"
            />
            <Script
              src="//unpkg.com/react-scan/dist/auto.global.js"
              crossOrigin="anonymous"
              strategy="beforeInteractive"
            />
          </>
        ) : null}
      </head>
      <body>{children}</body>
    </html>
  )
}
