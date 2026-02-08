export const metadata = { title: "Contact | LAEM Archive" };

export default function ContactPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-lg font-semibold tracking-tight">Contact</h1>
        <p className="text-sm text-neutral-600">Inquiries and requests.</p>
      </header>

      <div className="border border-neutral-200 p-6 max-w-xl space-y-2 text-sm text-neutral-700">
        <p>Email: <span className="font-medium">hello@laemarchive.com</span></p>
        <p className="text-xs text-neutral-500">Replace with your real address.</p>
      </div>
    </main>
  );
}
