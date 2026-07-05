import type { Metadata } from "next";
import { UpdateChecker } from "@/components/UpdateChecker";
import "./globals.css";

export const metadata: Metadata = {
  title: "AOCom",
  description: "Lightweight P2P voice, video and text for the squad",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint to avoid a flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var m={midnight:"nordic",cyberpunk:"mutedcyber",vampire:"graphite",emerald:"tactical"};var v=["nordic","graphite","mutedcyber","tactical"];var t=localStorage.getItem("aocom-theme");t=v.indexOf(t)>=0?t:(m[t]||"nordic");localStorage.setItem("aocom-theme",t);document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body className="antialiased">
        <UpdateChecker />
        {children}
      </body>
    </html>
  );
}
