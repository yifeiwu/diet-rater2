import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Diet Rater",
  description:
    "Plan meals and visualize macro and micro nutrients using USDA FoodData Central.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
