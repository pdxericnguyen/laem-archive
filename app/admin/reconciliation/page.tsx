import { redirect } from "next/navigation";

type LegacyDiagnosticsRedirectProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function appendSearchParam(params: URLSearchParams, key: string, value: string | string[]) {
  if (Array.isArray(value)) {
    value.forEach((item) => params.append(key, item));
    return;
  }
  params.set(key, value);
}

export default async function LegacyDiagnosticsRedirect({ searchParams }: LegacyDiagnosticsRedirectProps) {
  const resolvedSearchParams = (await searchParams) || {};
  const params = new URLSearchParams();

  Object.entries(resolvedSearchParams).forEach(([key, value]) => {
    if (typeof value === "string" || Array.isArray(value)) {
      appendSearchParam(params, key, value);
    }
  });

  const query = params.toString();
  redirect(query ? `/admin/dev-diagnostics?${query}` : "/admin/dev-diagnostics");
}
