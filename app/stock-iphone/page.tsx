import type { Metadata } from "next";
import StockTracker from "@/components/stock/StockTracker";

export const metadata: Metadata = {
  title: "Stock iPhone Duo en Apple Store — alertes de disponibilité",
  description:
    "Suivez en direct la disponibilité de l'iPhone Duo en retrait dans les Apple Store et recevez une notification dès qu'il arrive en stock.",
};

export default function StockIphonePage() {
  return <StockTracker />;
}
