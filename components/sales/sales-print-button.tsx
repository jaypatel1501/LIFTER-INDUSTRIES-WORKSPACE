"use client";

import { Button } from "@/components/ui/button";

export function SalesPrintButton() {
  return <Button className="print:hidden" onClick={() => window.print()}>Print / प्रिंट</Button>;
}
