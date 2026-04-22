import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Chat } from "@/components/chat";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/signin");
  return <Chat email={session.email} />;
}
