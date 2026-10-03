"use client";

import Link from "next/link";
import { Barcode, Building2, Boxes, FileBarChart2, History, Layers3, LayoutDashboard, MapPinned, ReceiptText, Ruler, Settings2, Shield, ShoppingCart, Truck, Users, UsersRound, WalletCards, type LucideIcon } from "lucide-react";
import { getDictionary } from "@/lib/i18n";
import { useDashboardUiStore } from "@/lib/ui-store";
import type { Locale } from "@prisma/client";

const managementLinks: {
  href: string;
  permission: string;
  english: string;
  hindi: string;
  Icon: LucideIcon;
}[] = [
  { href: "/dashboard/company", permission: "company:read", english: "Company settings", hindi: "कंपनी सेटिंग", Icon: Building2 },
  { href: "/dashboard/users", permission: "members:read", english: "Users", hindi: "उपयोगकर्ता", Icon: Users },
  { href: "/dashboard/roles", permission: "roles:read", english: "Groups & permissions", hindi: "समूह और अनुमतियाँ", Icon: Shield },
  { href: "/dashboard/financial-years", permission: "financial-years:read", english: "Financial years", hindi: "वित्तीय वर्ष", Icon: WalletCards },
  { href: "/dashboard/security", permission: "sessions:read", english: "Login & sessions", hindi: "लॉगिन और सत्र", Icon: History },
  { href: "/dashboard/audit", permission: "audit:read", english: "Audit trail", hindi: "ऑडिट ट्रेल", Icon: History },
  { href: "/dashboard/parties", permission: "parties:read", english: "Customers & suppliers", hindi: "ग्राहक और आपूर्तिकर्ता", Icon: UsersRound },
  { href: "/dashboard/sales", permission: "sales:read", english: "Sales", hindi: "बिक्री", Icon: ShoppingCart },
  { href: "/dashboard/sales-reports", permission: "sales-reports:read", english: "Sales reports", hindi: "बिक्री रिपोर्ट", Icon: FileBarChart2 },
  { href: "/dashboard/purchases", permission: "purchases:read", english: "Purchases", hindi: "खरीद", Icon: Truck },
  { href: "/dashboard/purchase-reports", permission: "purchase-reports:read", english: "Purchase reports", hindi: "खरीद रिपोर्ट", Icon: FileBarChart2 },
  { href: "/dashboard/ledgers", permission: "ledgers:read", english: "Ledgers", hindi: "खाते", Icon: WalletCards },
  { href: "/dashboard/ledger-groups", permission: "ledger-groups:read", english: "Ledger groups", hindi: "खाता समूह", Icon: Layers3 },
  { href: "/dashboard/accounting-reports", permission: "vouchers:read", english: "Accounting reports", hindi: "लेखा रिपोर्ट", Icon: FileBarChart2 },
  { href: "/dashboard/vouchers", permission: "vouchers:read", english: "Vouchers", hindi: "वाउचर", Icon: ReceiptText },
  { href: "/dashboard/day-book", permission: "vouchers:read", english: "Day Book", hindi: "डे बुक", Icon: History },
  { href: "/dashboard/tax-transactions", permission: "vouchers:read", english: "Tax transactions", hindi: "कर लेनदेन", Icon: FileBarChart2 },
  { href: "/dashboard/voucher-series", permission: "voucher-series:manage", english: "Voucher number series", hindi: "वाउचर नंबर श्रृंखला", Icon: ReceiptText },
  { href: "/dashboard/cost-centres", permission: "vouchers:read", english: "Cost centres", hindi: "लागत केंद्र", Icon: Layers3 },
  { href: "/dashboard/inventory", permission: "inventory:read", english: "Stock items", hindi: "स्टॉक आइटम", Icon: Boxes },
  { href: "/dashboard/stock-groups", permission: "stock-groups:read", english: "Stock groups", hindi: "स्टॉक समूह", Icon: Layers3 },
  { href: "/dashboard/units", permission: "units:read", english: "Units & conversions", hindi: "इकाइयाँ और रूपांतरण", Icon: Ruler },
  { href: "/dashboard/warehouses", permission: "warehouses:read", english: "Godowns & locations", hindi: "गोदाम और स्थान", Icon: MapPinned },
  { href: "/dashboard/inventory-reports", permission: "inventory:read", english: "Inventory reports", hindi: "इन्वेंटरी रिपोर्ट", Icon: Barcode },
];

export function Sidebar({ locale, permissions }: { locale: Locale; permissions: string[] }) {
  const copy = getDictionary(locale);
  const navigationOpen = useDashboardUiStore((state) => state.mobileNavigationOpen);
  const closeNavigation = useDashboardUiStore((state) => state.closeMobileNavigation);
  return (
    <aside className={`${navigationOpen ? "flex" : "hidden"} w-full shrink-0 flex-col border-b border-slate-200 bg-white lg:flex lg:min-h-screen lg:w-64 lg:border-b-0 lg:border-r`}>
      <Link href="/dashboard" className="flex items-center gap-3 px-5 py-5">
        <span className="grid size-10 place-items-center rounded-xl bg-blue-700 text-lg font-bold text-white">E</span>
        <span className="font-semibold tracking-tight text-slate-950">{copy.appName}</span>
      </Link>
      <nav id="primary-navigation" aria-label="Main navigation" className="flex flex-wrap gap-1 px-3 pb-3 lg:flex-col lg:px-3 lg:py-3">
        <Link
          href="/dashboard"
          onClick={closeNavigation}
          className="flex items-center gap-3 rounded-lg bg-blue-50 px-3 py-2.5 text-sm font-semibold text-blue-800"
        >
          <LayoutDashboard aria-hidden="true" size={18} />
          {copy.overview}
        </Link>
        <Link
          href="/dashboard/preferences"
          onClick={closeNavigation}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          <Settings2 aria-hidden="true" size={18} />
          {copy.preferences}
        </Link>
        {managementLinks.filter(({ permission }) => permissions.includes(permission)).map(
          ({ href, english, hindi, Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={closeNavigation}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              <Icon aria-hidden="true" size={18} />
              {locale === "HI" ? hindi : locale === "BILINGUAL" ? `${english} · ${hindi}` : english}
            </Link>
          ),
        )}
      </nav>
      <div className="mt-auto hidden border-t border-slate-100 p-5 text-xs leading-5 text-slate-500 lg:block">
        {copy.secureWorkspace}
      </div>
    </aside>
  );
}
