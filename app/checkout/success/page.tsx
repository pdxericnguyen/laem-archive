import SuccessClient from "./ui";

export const metadata = {
  title: "Order Received | LAEM Archive"
};

export default async function CheckoutSuccessPage({
  searchParams
}: {
  searchParams?: Promise<{ session_id?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const sessionId =
    typeof resolvedSearchParams?.session_id === "string" ? resolvedSearchParams.session_id : null;

  return <SuccessClient sessionId={sessionId} />;
}
