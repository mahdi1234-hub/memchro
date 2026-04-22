import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { SignIn } from "@/components/sign-in";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const session = await getSession();
  if (session) redirect("/");
  return <SignIn error={searchParams.error ?? null} />;
}
