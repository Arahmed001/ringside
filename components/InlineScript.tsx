/** A script that runs while the page is being parsed, so it can set things before the first paint (see Next's "preventing flash before hydration"). */
export function InlineScript({ html, nonce }: { html: string; nonce?: string }) {
  return <script nonce={nonce} type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />;
}
