import type { Metadata } from "next";
import PrivacyPolicyContent from "@/components/PrivacyPolicyContent";

export const metadata: Metadata = {
  title: "Privacy policy — Lycapps",
};

export default function PrivacyPolicyPage() {
  return <PrivacyPolicyContent />;
}
