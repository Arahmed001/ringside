"use client";
import { ErrorView } from "@/components/ErrorView";

/** A page in this language broke while rendering. The site's header, navigation and language switch stay (this sits inside the layout). */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorView digest={error.digest} retry={retry} />;
}
