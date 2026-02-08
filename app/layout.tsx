import "./globals.css";
import SiteHeader from "@/components/SiteHeader";

export const metadata = {
  title: "LAEM Archive",
  description: "Silver objects. Small runs. Archive-forward storefront."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        {children}
        <footer className="border-t border-neutral-200 py-6 text-xs text-neutral-600 mt-12">
          <div className="mx-auto max-w-6xl px-4">
            © {new Date().getFullYear()} LAEM Archive
          </div>
        </footer>
      </body>
    </html>
  );
}
