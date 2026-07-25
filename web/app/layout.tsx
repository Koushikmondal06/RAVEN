import type { Metadata } from 'next';
import { Anybody, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { Footer, Scanlines } from '../lib/Shell';
import { Providers } from './providers';
import './globals.css';

// Self-hosted at build time by next/font, so the static bundle has no runtime call to Google.
// Anybody carries every heading; JetBrains Mono carries everything else — the "hardened terminal".
const anybody = Anybody({ subsets: ['latin'], weight: ['700', '800', '900'], variable: '--font-anybody' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-jetbrains' });

export const metadata: Metadata = {
  title: 'RAVEN — rent compute, pay in SOL',
  description: 'Decentralized compute for the AI era. Rent high-performance machines. Pay by the second in SOL.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: wallet browser extensions inject attributes on <html>/<body> before
    // React hydrates, which is otherwise reported as a mismatch. It suppresses only these elements.
    <html lang="en" className={`${anybody.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Scanlines />
        <Providers>
          {children}
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
