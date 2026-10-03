import { notFound } from "next/navigation";

// Any URL that matches no page lands here, so the 404 is rendered inside the locale layout (styled, in the right language).
export default function CatchAll() {
  notFound();
}
