export const metadata = {
  title: "About | LAEM Archive",
  description: "Hand-finished silver objects produced in small runs."
};

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 space-y-12">
      <section className="space-y-6">
        <div className="relative aspect-[16/9] w-full overflow-hidden bg-neutral-100">
          <img
            src="https://via.placeholder.com/1600x900"
            alt="Studio documentation"
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>

        <div className="max-w-3xl space-y-3">
          <p className="text-xs uppercase tracking-[0.12em] text-neutral-600">About</p>
          <h1 className="text-lg font-semibold tracking-tight">Silver objects.</h1>
          <p className="text-sm leading-relaxed text-neutral-700">
            Hand-finished pieces produced in small runs. Designed for daily wear and
            intended to change over time—patina, polish, and small marks included.
          </p>
        </div>
      </section>

      <section className="space-y-6">
        <h2 className="text-sm font-semibold tracking-tight">The Standard</h2>

        <div className="grid gap-8 border-t border-neutral-200 pt-8 md:grid-cols-3">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.12em] text-neutral-600">Craft</p>
            <p className="text-sm leading-relaxed text-neutral-700">
              Small-batch production. Finished by hand. Edge, surface, and fit are treated
              as part of the object.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.12em] text-neutral-600">Materials</p>
            <p className="text-sm leading-relaxed text-neutral-700">
              Primarily solid silver (925). Gold and pearl appear sparingly as contrast.
              Materials are selected for durability and wear.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.12em] text-neutral-600">Form</p>
            <p className="text-sm leading-relaxed text-neutral-700">
              Minimal silhouettes with industrial restraint. Proportion, weight, and
              small asymmetries reveal themselves over time.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4 border-t border-neutral-200 pt-8">
        <p className="text-xs uppercase tracking-[0.12em] text-neutral-600">Catalog Note</p>
        <div className="max-w-3xl space-y-2 text-sm leading-relaxed text-neutral-700">
          <p>Availability reflects production capacity. Restocks are limited and not guaranteed.</p>
          <p>Archived pieces remain visible as part of the record.</p>
        </div>
      </section>

      <section className="border-t border-neutral-200 pt-8">
        <p className="text-sm text-neutral-700">
          Inquiries:{" "}
          <a href="/contact" className="underline hover:opacity-70">
            contact
          </a>
        </p>
      </section>
    </main>
  );
}
