import SuccessClient from "./ui";

export const metadata = {
  title: "Order Received | LAEM Archive"
};

export default function CheckoutSuccessPage({
  searchParams
}: {
  searchParams?: { session_id?: string };
}) {
  const sessionId = typeof searchParams?.session_id === "string" ? searchParams.session_id : null;

  return <SuccessClient sessionId={sessionId} />;
}
